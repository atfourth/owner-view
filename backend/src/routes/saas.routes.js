import {Router} from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {z} from 'zod';
import {pool,query} from '../config/db.js';
import {env} from '../config/env.js';
import {authenticate,authorize} from '../middleware/auth.js';
import {encrypt,decrypt,hash,safeEqual} from '../lib/security.js';

const r=Router();
const auth=authenticate;
const admin=authorize('admin');
const gym=req=>req.user.gym_id;

const modules=[
  'members','memberships','attendance','payments','finance',
  'trials','trainers','classes','equipment','whatsapp','online_payments'
];

function token(user){
  return jwt.sign({
    id:user.id,
    email:user.email,
    role:user.role,
    full_name:user.full_name,
    gym_id:user.gym_id,
    gym_name:user.gym_name,
    gym_slug:user.gym_slug
  },env.jwtSecret,{expiresIn:env.jwtExpiresIn});
}


function phoneValue(v){
  const d=String(v||'').replace(/\D/g,'');
  if(d.length===10)return '91'+d;
  if(d.length===11&&d.startsWith('0'))return '91'+d.slice(1);
  return d;
}



function invoiceNumber(){
  return 'INV-'+Date.now()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
}

function memberCode(prefix='M'){
  return prefix+'-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
}


function slugify(s){
  return s.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-|-$/g,'').slice(0,70)||'gym';
}

function moduleGate(key){
  return async(req,res,next)=>{
    try{
      const q=await query(
        'SELECT enabled FROM gym_modules WHERE gym_id=$1 AND module_key=$2',
        [gym(req),key]
      );
      if(!q.rowCount||!q.rows[0].enabled)
        return res.status(403).json({
          message:`${key} feature is disabled in this gym's settings`
        });
      next();
    }catch(e){next(e);}
  };
}

async function integration(g,provider){
  const q=await query(
    'SELECT config_encrypted,enabled FROM gym_integrations WHERE gym_id=$1 AND provider=$2',
    [g,provider]
  );
  return q.rowCount&&q.rows[0].enabled
    ?decrypt(q.rows[0].config_encrypted):null;
}

async function sendWhatsApp(g,phone,template,params=[]){
  const cfg=await integration(g,'whatsapp');
  if(!cfg)throw new Error('WhatsApp is not configured for this gym');

  const digits=phoneValue(phone);
  const body={
    messaging_product:'whatsapp',
    to:digits,
    type:'template',
    template:{
      name:template,
      language:{code:cfg.language||'en'},
      components:params.length?[{
        type:'body',
        parameters:params.map(text=>({type:'text',text:String(text)}))
      }]:[]
    }
  };

  const response=await fetch(
    `https://graph.facebook.com/${cfg.apiVersion||'v22.0'}/${cfg.phoneNumberId}/messages`,
    {
      method:'POST',
      headers:{
        Authorization:`Bearer ${cfg.accessToken}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(body)
    }
  );

  const data=await response.json();
  if(!response.ok)throw new Error(data.error?.message||'WhatsApp provider error');
  return data.messages?.[0]?.id||null;
}

async function logNotification(g,phone,kind,id,status,error=null,providerId=null){
  await query(`
    INSERT INTO notification_logs(
      gym_id,recipient,kind,reference_id,status,error,provider_message_id
    )
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(gym_id,kind,reference_id)
    DO UPDATE SET
      status=EXCLUDED.status,
      error=EXCLUDED.error,
      provider_message_id=EXCLUDED.provider_message_id,
      sent_at=NOW()
  `,[g,phone,kind,id,status,error,providerId]);
}

// Reconcile a confirmed Razorpay payment.
// Existing-member payments only settle the linked transaction.
// Trial payments can convert a trial visitor into a member.
async function reconcilePayment(g,providerOrderId){
  const c=await pool.connect();

  try{
    await c.query('BEGIN');

    const q=await c.query(`
      SELECT
        po.id order_row_id,
        po.payment_id,
        po.status order_status,
        p.trial_visitor_id,
        p.subscription_id,
        p.user_id
      FROM payment_orders po
      JOIN payments p
        ON p.id=po.payment_id AND p.gym_id=po.gym_id
      WHERE po.gym_id=$1 AND po.provider_order_id=$2
      FOR UPDATE
    `,[g,providerOrderId]);

    if(!q.rowCount){
      await c.query('COMMIT');
      return;
    }

    const row=q.rows[0];

    if(row.order_status==='paid'){
      await c.query('COMMIT');
      return;
    }

    await c.query(`
      UPDATE payments
      SET status='paid',paid_at=NOW()
      WHERE id=$1 AND gym_id=$2
    `,[row.payment_id,g]);

    await c.query(`
      UPDATE payment_orders
      SET status='paid'
      WHERE id=$1
    `,[row.order_row_id]);

    if(row.trial_visitor_id){
      const t=await c.query(`
        SELECT *
        FROM trial_visitors
        WHERE id=$1 AND gym_id=$2
        FOR UPDATE
      `,[row.trial_visitor_id,g]);

      if(t.rowCount&&t.rows[0].status!=='converted'&&t.rows[0].interested_plan_id){
        const trial=t.rows[0];

        let member=await c.query(`
          SELECT id
          FROM users
          WHERE gym_id=$1 AND phone=$2 AND role='member'
        `,[g,trial.phone]);

        if(!member.rowCount){
          member=await c.query(`
            INSERT INTO users(
              gym_id,member_code,full_name,email,password_hash,
              phone,role,status,whatsapp_opt_in,whatsapp_opt_in_at
            )
            VALUES(
              $1,$2,$3,$4,$5,$6,'member','active',$7,
              CASE WHEN $7 THEN NOW() ELSE NULL END
            )
            RETURNING id
          `,[
            g,memberCode('M'),trial.full_name,trial.email,
            await bcrypt.hash(crypto.randomBytes(24).toString('hex'),10),
            trial.phone,trial.whatsapp_opt_in
          ]);
        }

        const memberId=member.rows[0].id;

        if(trial.whatsapp_opt_in){
          await c.query(`
            UPDATE users
            SET whatsapp_opt_in=true,
                whatsapp_opt_in_at=COALESCE(whatsapp_opt_in_at,NOW())
            WHERE id=$1 AND gym_id=$2
          `,[memberId,g]);
        }

        const plan=await c.query(`
          SELECT duration_days,price
          FROM membership_plans
          WHERE id=$1 AND gym_id=$2
        `,[trial.interested_plan_id,g]);

        if(plan.rowCount){
          await c.query(`
            UPDATE member_subscriptions
            SET status='expired'
            WHERE gym_id=$1 AND user_id=$2 AND status='active'
          `,[g,memberId]);

          await c.query(`
            UPDATE users SET status='active'
            WHERE id=$1 AND gym_id=$2
          `,[memberId,g]);

          const sub=(await c.query(`
            INSERT INTO member_subscriptions(
              gym_id,user_id,plan_id,start_date,end_date,status,total_amount
            )
            VALUES(
              $1,$2,$3,CURRENT_DATE,
              CURRENT_DATE+($4-1),'active',$5
            )
            RETURNING id
          `,[
            g,memberId,trial.interested_plan_id,
            plan.rows[0].duration_days,plan.rows[0].price
          ])).rows[0];

          await c.query(`
            UPDATE payments
            SET user_id=$1,subscription_id=$2
            WHERE id=$3 AND gym_id=$4
          `,[memberId,sub.id,row.payment_id,g]);

          await c.query(`
            UPDATE trial_visitors
            SET status='converted',converted_member_id=$1
            WHERE id=$2 AND gym_id=$3
          `,[memberId,trial.id,g]);
        }
      }
    }

    await c.query('COMMIT');
  }catch(e){
    await c.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    c.release();
  }
}

// Enforce owner-selected modules at the API boundary.
r.use('/members',auth,moduleGate('members'));
r.use('/plans',auth,moduleGate('memberships'));
r.use('/attendance',auth,moduleGate('attendance'));
r.use('/finance',auth,moduleGate('finance'));
r.use('/trials',auth,moduleGate('trials'));
r.use('/trainers',auth,moduleGate('trainers'));
r.use('/classes',auth,moduleGate('classes'));
r.use('/equipment',auth,moduleGate('equipment'));

// Owner registration and login.
r.post('/register',async(req,res,next)=>{
  const c=await pool.connect();
  try{
    const d=z.object({
      gym_name:z.string().min(2).max(160),
      full_name:z.string().min(2),
      email:z.string().email(),
      phone:z.string().min(7).refine(
        v=>phoneValue(v).length>=10,'Enter a valid phone number'
      ),
      password:z.string().min(10)
    }).parse(req.body);

    const email=d.email.toLowerCase().trim();
    await c.query('BEGIN');

    const exists=await c.query(
      "SELECT id FROM users WHERE lower(email)=lower($1) AND role='admin'",
      [email]
    );

    if(exists.rowCount)
      throw Object.assign(
        new Error('An owner account with this email already exists'),
        {status:409}
      );

    let slug=slugify(d.gym_name);
    const taken=await c.query('SELECT 1 FROM gyms WHERE slug=$1',[slug]);
    if(taken.rowCount)slug+=`-${crypto.randomBytes(3).toString('hex')}`;

    const g=(await c.query(
      'INSERT INTO gyms(name,slug,owner_email,phone) VALUES($1,$2,$3,$4) RETURNING *',
      [d.gym_name,slug,email,phoneValue(d.phone)]
    )).rows[0];

    const u=(await c.query(`
      INSERT INTO users(
        gym_id,member_code,full_name,email,password_hash,phone,role,status
      )
      VALUES($1,'OWNER-001',$2,$3,$4,$5,'admin','active')
      RETURNING id,full_name,email,phone,role,gym_id
    `,[
      g.id,d.full_name,email,
      await bcrypt.hash(d.password,12),phoneValue(d.phone)
    ])).rows[0];

    await c.query(
      'INSERT INTO gym_settings(gym_id,settings) VALUES($1,$2)',
      [g.id,JSON.stringify({
        reminder_days_before:1,
        trial_duration_days:3,
        timezone:'Asia/Kolkata',
        currency:'INR'
      })]
    );

    for(const m of modules){
      await c.query(
        'INSERT INTO gym_modules(gym_id,module_key,enabled) VALUES($1,$2,$3)',
        [g.id,m,['members','memberships','attendance','payments','finance','trials','trainers'].includes(m)]
      );
    }

    await c.query('COMMIT');
    u.gym_name=g.name;
    u.gym_slug=g.slug;
    res.status(201).json({token:token(u),user:u,gym:g});
  }catch(e){
    await c.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{c.release();}
});

r.post('/login',async(req,res,next)=>{
  try{
    const d=z.object({
      email:z.string().email(),
      password:z.string().min(1)
    }).parse(req.body);

    const q=await query(`
      SELECT
        u.id,u.full_name,u.email,u.phone,u.role,u.gym_id,
        g.name gym_name,g.slug gym_slug,u.password_hash
      FROM users u
      JOIN gyms g ON g.id=u.gym_id
      WHERE lower(u.email)=lower($1)
        AND u.role IN ('admin','staff')
        AND u.status='active'
        AND g.status='active'
    `,[d.email]);

    if(!q.rowCount||!(await bcrypt.compare(d.password,q.rows[0].password_hash)))
      return res.status(401).json({message:'Invalid email or password'});

    const u=q.rows[0];
    delete u.password_hash;
    res.json({token:token(u),user:u});
  }catch(e){next(e);}
});

r.get('/me',auth,async(req,res,next)=>{
  try{
    const q=await query(`
      SELECT
        u.id,u.full_name,u.email,u.phone,u.role,u.gym_id,
        g.name gym_name,g.slug gym_slug
      FROM users u
      JOIN gyms g ON g.id=u.gym_id
            WHERE u.id=$1 AND u.gym_id=$2
    `,[req.user.id,gym(req)]);

    if(!q.rowCount)
      return res.status(404).json({message:'Account not found'});

    const [mods,settings]=await Promise.all([
      query('SELECT module_key,enabled FROM gym_modules WHERE gym_id=$1',[gym(req)]),
      query('SELECT settings FROM gym_settings WHERE gym_id=$1',[gym(req)])
    ]);

    res.json({
      user:q.rows[0],
      modules:mods.rows,
      settings:settings.rows[0]?.settings||{}
    });
  }catch(e){next(e);}
});

// Dashboard.
r.get('/dashboard/stats',auth,async(req,res,next)=>{
  try{
    const g=gym(req);

    const [
      members,revenue,attendance,expenses,
      expiring,checkins,modulesResult,recentPayments
    ]=await Promise.all([

      query(`
        SELECT
          COUNT(*) FILTER(
            WHERE u.status='active'
              AND EXISTS(
                SELECT 1 FROM member_subscriptions ms
                WHERE ms.gym_id=u.gym_id
                  AND ms.user_id=u.id
                  AND ms.status='active'
                  AND ms.end_date>=CURRENT_DATE
              )
          )::int active_members,
          COUNT(*) FILTER(WHERE u.status='frozen')::int frozen_members,
          COUNT(*) FILTER(WHERE u.status='inactive')::int inactive_members,
          COUNT(*)::int total_members
        FROM users u
        WHERE u.gym_id=$1 AND u.role='member'
      `,[g]),

      query(`
        SELECT
          COALESCE(SUM(total_amount) FILTER(
            WHERE status='paid'
              AND date_trunc('month',paid_at)=date_trunc('month',CURRENT_DATE)
          ),0)::numeric(12,2) month_revenue,
          COALESCE(SUM(total_amount) FILTER(
            WHERE status='paid'
          ),0)::numeric(12,2) total_revenue,
          COUNT(*) FILTER(WHERE status='pending')::int pending_count
        FROM payments
        WHERE gym_id=$1 AND entry_type='payment'
      `,[g]),

      query(`
        SELECT
          COUNT(*) FILTER(
            WHERE attendance_date=CURRENT_DATE
          )::int today_attendance,
          COUNT(*) FILTER(
            WHERE attendance_date=CURRENT_DATE
              AND check_out_time IS NULL
          )::int currently_in_gym
        FROM attendance_logs
        WHERE gym_id=$1
      `,[g]),

      query(`
        SELECT
          COALESCE(SUM(amount) FILTER(
            WHERE date_trunc('month',expense_date)=date_trunc('month',CURRENT_DATE)
          ),0)::numeric(12,2) month_expenses,
          COALESCE(SUM(amount),0)::numeric(12,2) total_expenses
        FROM expenses
        WHERE gym_id=$1
      `,[g]),

      query(`
        SELECT
          ms.id,u.id member_id,u.full_name,u.member_code,u.phone,
          mp.name plan_name,ms.end_date,
          (ms.end_date-CURRENT_DATE)::int days_remaining
        FROM member_subscriptions ms
        JOIN users u ON u.id=ms.user_id AND u.gym_id=ms.gym_id
        JOIN membership_plans mp ON mp.id=ms.plan_id AND mp.gym_id=ms.gym_id
        WHERE ms.gym_id=$1
          AND ms.status='active'
          AND ms.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE+7
        ORDER BY ms.end_date
      `,[g]),

      query(`
        SELECT
          a.id,a.check_in_time,a.check_out_time,a.check_in_method,
          u.full_name,u.member_code
        FROM attendance_logs a
        JOIN users u ON u.id=a.user_id AND u.gym_id=a.gym_id
        WHERE a.gym_id=$1
        ORDER BY a.check_in_time DESC
        LIMIT 8
      `,[g]),

      query('SELECT module_key,enabled FROM gym_modules WHERE gym_id=$1',[g]),

      query(`
        SELECT
          p.*,
          COALESCE(u.full_name,tv.full_name) full_name,
          COALESCE(u.member_code,'TRIAL') member_code
        FROM payments p
        LEFT JOIN users u ON u.id=p.user_id AND u.gym_id=p.gym_id
        LEFT JOIN trial_visitors tv ON tv.id=p.trial_visitor_id AND tv.gym_id=p.gym_id
        WHERE p.gym_id=$1 AND p.entry_type='payment'
        ORDER BY p.created_at DESC
        LIMIT 8
      `,[g])
    ]);

    res.json({
      stats:{
        ...members.rows[0],
        ...revenue.rows[0],
        ...attendance.rows[0],
        ...expenses.rows[0],
        net_month:
          Number(revenue.rows[0].month_revenue)-
          Number(expenses.rows[0].month_expenses)
      },
      expiring:expiring.rows,
      recentCheckins:checkins.rows,
      recentPayments:recentPayments.rows,
      modules:modulesResult.rows
    });
  }catch(e){next(e);}
});

r.get('/modules',auth,async(req,res,next)=>{
  try{
    res.json({
      modules:(await query(
        'SELECT module_key,enabled FROM gym_modules WHERE gym_id=$1 ORDER BY module_key',
        [gym(req)]
      )).rows
    });
  }catch(e){next(e);}
});

r.patch('/modules/:key',auth,admin,async(req,res,next)=>{
  try{
    const key=req.params.key;
    if(!modules.includes(key))
      return res.status(404).json({message:'Unknown module'});

    const enabled=z.boolean().parse(req.body.enabled);

    if(!enabled&&['members','memberships','attendance'].includes(key))
      return res.status(400).json({message:'Core gym modules cannot be disabled'});

    if(enabled&&key==='online_payments'){
      const p=await query(
        "SELECT enabled FROM gym_modules WHERE gym_id=$1 AND module_key='payments'",
        [gym(req)]
      );
      if(!p.rows[0]?.enabled)
        return res.status(409).json({message:'Enable payment records before online payments'});
    }

    if(enabled&&['whatsapp','online_payments'].includes(key)){
      const cfg=await integration(gym(req),key==='whatsapp'?'whatsapp':'razorpay');
      if(!cfg)
        return res.status(409).json({message:'Configure this integration before enabling it'});
    }

    const q=await query(
      'UPDATE gym_modules SET enabled=$1 WHERE gym_id=$2 AND module_key=$3 RETURNING *',
      [enabled,gym(req),key]
    );
    res.json({module:q.rows[0]});
  }catch(e){next(e);}
});

r.patch('/settings',auth,admin,async(req,res,next)=>{
  try{
    const d=z.object({
      name:z.string().min(2).optional(),
      email:z.string().email().optional(),
      phone:z.string().min(7).refine(
        v=>phoneValue(v).length>=10,'Enter a valid phone number'
      ).optional(),
      password:z.string().min(10).optional(),
      reminder_days_before:z.number().int().min(1).max(7).optional(),
      trial_duration_days:z.number().int().min(1).max(30).optional(),
      timezone:z.string().optional()
    }).parse(req.body);

    const c=await pool.connect();

    try{
      await c.query('BEGIN');

      if(d.name||d.email||d.phone){
        await c.query(`
          UPDATE gyms
          SET name=COALESCE($1,name),
              owner_email=COALESCE($2,owner_email),
              phone=COALESCE($3,phone)
          WHERE id=$4
        `,[d.name,d.email?.toLowerCase(),d.phone?phoneValue(d.phone):null,gym(req)]);

        await c.query(`
          UPDATE users
          SET email=COALESCE($1,email),
              phone=COALESCE($2,phone)
          WHERE id=$3 AND gym_id=$4
        `,[d.email?.toLowerCase(),d.phone?phoneValue(d.phone):null,req.user.id,gym(req)]);
      }

      if(d.password){
        await c.query(
          'UPDATE users SET password_hash=$1 WHERE id=$2 AND gym_id=$3',
          [await bcrypt.hash(d.password,12),req.user.id,gym(req)]
        );
      }

      const settings={
        ...(await c.query(
          'SELECT settings FROM gym_settings WHERE gym_id=$1',
          [gym(req)]
        )).rows[0]?.settings,
        ...Object.fromEntries(
          Object.entries(d).filter(([k])=>
            ['reminder_days_before','trial_duration_days','timezone'].includes(k)
          )
        )
      };

      await c.query(`
        INSERT INTO gym_settings(gym_id,settings)
        VALUES($1,$2)
        ON CONFLICT(gym_id)
        DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()
      `,[gym(req),JSON.stringify(settings)]);

      await c.query('COMMIT');
      res.json({message:'Settings updated',settings});
    }catch(e){
      await c.query('ROLLBACK');
      throw e;
    }finally{c.release();}
  }catch(e){next(e);}
});

r.get('/backup',auth,admin,async(req,res,next)=>{
  try{
    const g=gym(req);
    const tables=[
      'gyms','users','membership_plans','member_subscriptions',
      'attendance_logs','payments','trainers','fitness_classes',
      'class_bookings','equipment','expenses','trial_visitors',
      'gym_settings','gym_modules'
    ];

    const backup={
      format:'ironpulse-backup-v1',
      created_at:new Date().toISOString(),
      data:{}
    };

    for(const t of tables){
      const q=t==='users'
        ?await query(`
          SELECT
            id,gym_id,member_code,full_name,email,phone,role,status,
            whatsapp_opt_in,whatsapp_opt_in_at,created_at,updated_at
          FROM users WHERE gym_id=$1
        `,[g])
        :await query(`SELECT * FROM ${t} WHERE gym_id=$1`,[g]).catch(
          async()=>t==='gyms'
            ?query('SELECT * FROM gyms WHERE id=$1',[g])
            :{rows:[]}
        );

      backup.data[t]=q.rows;
    }

    res.setHeader('Content-Type','application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ironpulse-${g}-backup.json"`
    );
    res.send(JSON.stringify(backup,null,2));
  }catch(e){next(e);}
});

r.post('/reset',auth,admin,async(req,res,next)=>{
  const c=await pool.connect();
  try{
    if(req.body.confirmation!=='RESET MY GYM DATA')
      return res.status(400).json({message:'Type RESET MY GYM DATA to confirm'});

    const g=gym(req);
    await c.query('BEGIN');

    for(const t of [
      'class_bookings','attendance_logs','payment_orders',
      'notification_logs','otp_challenges','payments',
      'member_subscriptions','trial_visitors','expenses',
      'fitness_classes','trainers','equipment'
    ]){
      await c.query(`DELETE FROM ${t} WHERE gym_id=$1`,[g]);
    }

    await c.query(
      "DELETE FROM users WHERE gym_id=$1 AND role IN ('member','trainer')",
      [g]
    );

    await c.query('COMMIT');
    res.json({
      message:'Gym operational data reset. Owner account and settings were retained.'
    });
  }catch(e){
    await c.query('ROLLBACK');
    next(e);
  }finally{c.release();}
});

r.put('/integrations/:provider',auth,admin,async(req,res,next)=>{
  try{
    const provider=req.params.provider;
    let d;

    if(provider==='whatsapp'){
      d=z.object({
        phoneNumberId:z.string().min(3),
        accessToken:z.string().min(10),
        apiVersion:z.string().default('v22.0'),
        language:z.string().default('en'),
        renewalTemplate:z.string().min(2),
        trialTemplate:z.string().min(2),
        otpTemplate:z.string().min(2),
        paymentLinkTemplate:z.string().optional().default('payment_link')
      }).parse(req.body);
    }else if(provider==='razorpay'){
      d=z.object({
        keyId:z.string().min(5),
        keySecret:z.string().min(10),
        webhookSecret:z.string().min(10)
      }).parse(req.body);
    }else{
      return res.status(404).json({message:'Provider not supported'});
    }

    await query(`
      INSERT INTO gym_integrations(gym_id,provider,config_encrypted,enabled)
      VALUES($1,$2,$3,true)
      ON CONFLICT(gym_id,provider)
      DO UPDATE SET
        config_encrypted=EXCLUDED.config_encrypted,
        enabled=true,updated_at=NOW()
    `,[gym(req),provider,encrypt(d)]);

    res.json({
      message:`${provider} configuration saved securely`,
      enabled:true
    });
  }catch(e){next(e);}
});

r.get('/integrations/status',auth,async(req,res,next)=>{
  try{
    const q=await query(
      'SELECT provider,enabled,updated_at FROM gym_integrations WHERE gym_id=$1',
      [gym(req)]
    );
    res.json({integrations:q.rows});
  }catch(e){next(e);}
});

// Membership plans.
r.get('/plans',auth,async(req,res,next)=>{
  try{
    res.json({
      plans:(await query(`
        SELECT
          mp.*,
          (
            SELECT COUNT(*)::int
            FROM member_subscriptions ms
            WHERE ms.gym_id=mp.gym_id
              AND ms.plan_id=mp.id
              AND ms.status='active'
                            AND ms.end_date>=CURRENT_DATE
          ) active_subscribers
        FROM membership_plans mp
        WHERE mp.gym_id=$1
        ORDER BY mp.created_at DESC
      `,[gym(req)])).rows
    });
  }catch(e){next(e);}
});

r.post('/plans',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const d=z.object({
      name:z.string().min(2),
      description:z.string().optional().default(''),
      duration_days:z.coerce.number().int().positive(),
      price:z.coerce.number().nonnegative(),
      features:z.array(z.string()).default([]),
      is_active:z.boolean().default(true)
    }).parse(req.body);

    const q=await query(`
      INSERT INTO membership_plans(
        gym_id,name,description,duration_days,price,currency,features,is_active
      )
      VALUES($1,$2,$3,$4,$5,'INR',$6::jsonb,$7)
      RETURNING *
    `,[
      gym(req),d.name,d.description,d.duration_days,
      d.price,JSON.stringify(d.features),d.is_active
    ]);

    res.status(201).json({plan:q.rows[0]});
  }catch(e){next(e);}
});

r.patch('/plans/:id',auth,admin,async(req,res,next)=>{
  try{
    const d=z.object({
      name:z.string().min(2).optional(),
      description:z.string().optional(),
      duration_days:z.coerce.number().int().positive().optional(),
      price:z.coerce.number().nonnegative().optional(),
      is_active:z.boolean().optional()
    }).parse(req.body);

    const keys=Object.keys(d);
    if(!keys.length)return res.status(400).json({message:'No updates'});

    const vals=keys.map(k=>d[k]);
    const set=keys.map((k,i)=>`${k}=$${i+1}`).join(',');

    const q=await query(`
      UPDATE membership_plans
      SET ${set},updated_at=NOW()
      WHERE id=$${keys.length+1} AND gym_id=$${keys.length+2}
      RETURNING *
    `,[...vals,req.params.id,gym(req)]);

    if(!q.rowCount)return res.status(404).json({message:'Plan not found'});
    res.json({plan:q.rows[0]});
  }catch(e){next(e);}
});

// Create a member and, when selected, their first membership.
r.post('/members',auth,authorize('admin','staff'),async(req,res,next)=>{
  const c=await pool.connect();
  try{
    const d=z.object({
      full_name:z.string().trim().min(2).max(160),
      email:z.string().trim().email().optional().or(z.literal('')),
      phone:z.string().trim().min(7).max(30),
      plan_id:z.string().uuid().optional().or(z.literal('')),
      amount_paid:z.coerce.number().nonnegative().default(0),
      payment_method:z.enum(['cash','upi','bank_transfer','card','online']).default('cash'),
      whatsapp_opt_in:z.boolean().default(false)
    }).parse(req.body);
    await c.query('BEGIN');
    const email=d.email?d.email.toLowerCase():null;
    if(email){
      const duplicate=await c.query(
        'SELECT id FROM users WHERE gym_id=$1 AND lower(email)=lower($2) AND role=\'member\'',
        [gym(req),email]
      );
      if(duplicate.rowCount)throw Object.assign(new Error('A member with this email already exists'),{status:409});
    }
    const duplicatePhone=await c.query(
      'SELECT id FROM users WHERE gym_id=$1 AND phone=$2 AND role=\'member\'',
      [gym(req),phoneValue(d.phone)]
    );
    if(duplicatePhone.rowCount)throw Object.assign(new Error('A member with this phone number already exists'),{status:409});

    let plan=null;
    if(d.plan_id){
      const p=await c.query('SELECT * FROM membership_plans WHERE id=$1 AND gym_id=$2 AND is_active=true',[d.plan_id,gym(req)]);
      if(!p.rowCount)throw Object.assign(new Error('Selected membership plan not found'),{status:404});
      plan=p.rows[0];
      if(d.amount_paid>Number(plan.price))throw Object.assign(new Error('Amount paid cannot exceed the plan price'),{status:400});
    }else if(d.amount_paid>0){
      throw Object.assign(new Error('Select a membership plan before recording an amount paid'),{status:400});
    }

    const tempPassword=crypto.randomBytes(24).toString('hex');
    const member=(await c.query(`
      INSERT INTO users(gym_id,member_code,full_name,email,password_hash,phone,role,status,whatsapp_opt_in)
      VALUES($1,$2,$3,$4,$5,$6,'member','active',$7)
      RETURNING id,member_code,full_name,email,phone,role,status,whatsapp_opt_in,created_at
    `,[gym(req),memberCode(),d.full_name,email,await bcrypt.hash(tempPassword,12),phoneValue(d.phone),d.whatsapp_opt_in])).rows[0];

    let subscription=null;
    if(plan){
      subscription=(await c.query(`
        INSERT INTO member_subscriptions(gym_id,user_id,plan_id,start_date,end_date,status,total_amount)
        VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+($4-1),'active',$5) RETURNING *
      `,[gym(req),member.id,plan.id,plan.duration_days,plan.price])).rows[0];
      if(d.amount_paid>0){
        await c.query(`
          INSERT INTO payments(gym_id,invoice_number,user_id,subscription_id,amount,total_amount,payment_method,status,paid_at,description,entry_type,recorded_by)
          VALUES($1,$2,$3,$4,$5,$5,$6,'paid',NOW(),$7,'payment',$8)
        `,[gym(req),invoiceNumber(),member.id,subscription.id,d.amount_paid,d.payment_method,`${plan.name} membership payment`,req.user.id]);
      }
    }
    await c.query('COMMIT');
    res.status(201).json({member,subscription,total_amount:plan?Number(plan.price):0,amount_paid:d.amount_paid,pending_amount:plan?Number(plan.price)-d.amount_paid:0});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});next(e);}
  finally{c.release();}
});

// Update basic member details, scoped to the authenticated gym.
r.patch('/members/:id',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const d=z.object({
      full_name:z.string().trim().min(2).max(160).optional(),
      email:z.string().trim().email().nullable().optional(),
      phone:z.string().trim().min(7).max(30).optional(),
      whatsapp_opt_in:z.boolean().optional()
    }).parse(req.body);
    if(!Object.keys(d).length)return res.status(400).json({message:'No updates supplied'});
    if(d.email)d.email=d.email.toLowerCase();
    if(d.phone)d.phone=phoneValue(d.phone);
    const keys=Object.keys(d),values=keys.map(k=>d[k]);
    const sets=keys.map((k,i)=>`${k}=$${i+1}`).join(',');
    const q=await query(`UPDATE users SET ${sets},updated_at=NOW() WHERE id=$${keys.length+1} AND gym_id=$${keys.length+2} AND role='member' RETURNING id,member_code,full_name,email,phone,status,whatsapp_opt_in`,[...values,req.params.id,gym(req)]);
    if(!q.rowCount)return res.status(404).json({message:'Member not found'});
    res.json({member:q.rows[0]});
  }catch(e){next(e);}
});

// Member directory with actual collected payments and outstanding balance.
r.get('/members',auth,async(req,res,next)=>{
  try{
    const s=String(req.query.search||'').trim();
    const status=String(req.query.status||'');

    const q=await query(`
      SELECT
        u.id,u.member_code,u.full_name,u.email,u.phone,u.whatsapp_opt_in,
        CASE
          WHEN u.status='frozen' THEN 'frozen'
          WHEN ms.end_date<CURRENT_DATE AND ms.status='active' THEN 'expired'
          ELSE u.status
        END status,
        u.created_at,
        ms.id subscription_id,
        ms.plan_id,ms.start_date,ms.end_date,
        ms.status subscription_status,
        mp.name plan_name,
        ms.total_amount,
        COALESCE(paid.total_paid,0)::numeric(12,2) total_paid,
        GREATEST(
          COALESCE(ms.total_amount,0)-COALESCE(paid.total_paid,0),0
        )::numeric(12,2) pending_amount,
        CASE
          WHEN ms.id IS NULL THEN 'no_membership'
          WHEN GREATEST(
            COALESCE(ms.total_amount,0)-COALESCE(paid.total_paid,0),0
          )=0 THEN 'fully_paid'
          WHEN COALESCE(paid.total_paid,0)=0 THEN 'pending'
          ELSE 'partial'
        END payment_status
      FROM users u
      LEFT JOIN LATERAL(
        SELECT *
        FROM member_subscriptions
        WHERE gym_id=u.gym_id AND user_id=u.id
        ORDER BY created_at DESC
        LIMIT 1
      ) ms ON TRUE
      LEFT JOIN membership_plans mp
        ON mp.id=ms.plan_id AND mp.gym_id=u.gym_id
      LEFT JOIN LATERAL(
        SELECT COALESCE(SUM(total_amount),0) total_paid
        FROM payments
        WHERE gym_id=u.gym_id
          AND user_id=u.id
          AND subscription_id=ms.id
          AND entry_type='payment'
          AND status='paid'
      ) paid ON TRUE
      WHERE u.gym_id=$1
        AND u.role='member'
        AND (
          $2='' OR u.full_name ILIKE '%'||$2||'%'
          OR u.phone ILIKE '%'||$2||'%'
          OR u.member_code ILIKE '%'||$2||'%'
        )
        AND (
          $3='' OR $3='all'
          OR (
            CASE
              WHEN u.status='frozen' THEN 'frozen'
              WHEN ms.end_date<CURRENT_DATE AND ms.status='active' THEN 'expired'
              ELSE u.status
            END
          )=$3
        )
      ORDER BY u.created_at DESC
      LIMIT 500
    `,[gym(req),s,status]);

    res.json({members:q.rows});
  }catch(e){next(e);}
});

// Assign or renew membership. Amount paid is a real transaction;
// pending balance is derived from total_amount minus successful payments.
r.post('/members/:id/subscriptions',auth,authorize('admin','staff'),async(req,res,next)=>{
  const c=await pool.connect();

  try{
    const d=z.object({
      plan_id:z.string().uuid(),
      payment_method:z.enum([
        'cash','upi','bank_transfer','card','online'
      ]).default('cash'),
      amount_paid:z.coerce.number().nonnegative().default(0),
      start_date:z.string().optional()
    }).parse(req.body);

    await c.query('BEGIN');

    const p=await c.query(`
      SELECT *
      FROM membership_plans
      WHERE id=$1 AND gym_id=$2 AND is_active=true
    `,[d.plan_id,gym(req)]);

    if(!p.rowCount)
      throw Object.assign(new Error('Plan not found'),{status:404});

    const u=await c.query(`
      SELECT id
      FROM users
      WHERE id=$1 AND gym_id=$2 AND role='member'
      FOR UPDATE
    `,[req.params.id,gym(req)]);

    if(!u.rowCount)
      throw Object.assign(new Error('Member not found'),{status:404});

    const plan=p.rows[0];
    const price=Number(plan.price);

    if(d.amount_paid>price)
      throw Object.assign(
        new Error('Amount paid cannot exceed the plan price'),
        {status:400}
      );

    const start=d.start_date||null;

    await c.query(`
      UPDATE member_subscriptions
      SET status='expired'
      WHERE gym_id=$1 AND user_id=$2 AND status='active'
    `,[gym(req),req.params.id]);

    const sub=(await c.query(`
      INSERT INTO member_subscriptions(
        gym_id,user_id,plan_id,start_date,end_date,status,total_amount
      )
      VALUES(
        $1,$2,$3,COALESCE($4::date,CURRENT_DATE),
        COALESCE($4::date,CURRENT_DATE)+($5-1),'active',$6
      )
      RETURNING *
    `,[
      gym(req),req.params.id,d.plan_id,start,
      plan.duration_days,price
    ])).rows[0];

    await c.query(
      "UPDATE users SET status='active' WHERE id=$1 AND gym_id=$2",
      [req.params.id,gym(req)]
    );

    if(d.amount_paid>0){
      await c.query(`
        INSERT INTO payments(
          gym_id,invoice_number,user_id,subscription_id,
          amount,total_amount,payment_method,status,paid_at,
          description,entry_type,recorded_by
        )
        VALUES($1,$2,$3,$4,$5,$5,$6,'paid',NOW(),$7,'payment',$8)
      `,[
        gym(req),invoiceNumber(),req.params.id,sub.id,
        d.amount_paid,d.payment_method,
        `${plan.name} membership payment`,req.user.id
      ]);
    }

    await c.query('COMMIT');

    res.status(201).json({
      subscription:sub,
      total_amount:price,
      amount_paid:d.amount_paid,
      pending_amount:price-d.amount_paid
    });
  }catch(e){
    await c.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{c.release();}
});
// Attendance.
r.get('/attendance',auth,async(req,res,next)=>{
  try{
    const active=String(req.query.activeOnly)==='true';

    const q=await query(`
      SELECT
        a.*,u.full_name,u.member_code,u.phone,mp.name plan_name
      FROM attendance_logs a
      JOIN users u ON u.id=a.user_id AND u.gym_id=a.gym_id
      LEFT JOIN LATERAL(
        SELECT plan_id
        FROM member_subscriptions ms
        WHERE ms.gym_id=a.gym_id AND ms.user_id=a.user_id
        ORDER BY created_at DESC
        LIMIT 1
      ) ms ON TRUE
      LEFT JOIN membership_plans mp
        ON mp.id=ms.plan_id AND mp.gym_id=a.gym_id
      WHERE a.gym_id=$1
        AND a.attendance_date=CURRENT_DATE
        AND ($2=false OR a.check_out_time IS NULL)
      ORDER BY a.check_in_time DESC
      LIMIT 300
    `,[gym(req),active]);

    res.json({logs:q.rows});
  }catch(e){next(e);}
});

r.post('/attendance/check-in',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const d=z.object({
      member_id:z.string().optional(),
      identifier:z.string().optional(),
      check_in_method:z.enum([
        'front_desk','member_code','qr_code'
      ]).default('front_desk')
    }).refine(v=>v.member_id||v.identifier).parse(req.body);

    const ident=d.member_id||d.identifier;

    const m=await query(`
      SELECT id,status,full_name,member_code
      FROM users
      WHERE gym_id=$1 AND role='member'
        AND (
          id::text=$2 OR lower(member_code)=lower($2)
          OR lower(email)=lower($2) OR phone=$2
        )
    `,[gym(req),ident]);

    if(!m.rowCount||m.rows[0].status!=='active')
      return res.status(404).json({message:'Active member not found'});

    const sub=await query(`
      SELECT id
      FROM member_subscriptions
      WHERE gym_id=$1 AND user_id=$2
        AND status='active' AND end_date>=CURRENT_DATE
      ORDER BY end_date DESC
      LIMIT 1
    `,[gym(req),m.rows[0].id]);

    if(!sub.rowCount)
      return res.status(403).json({
        message:'Membership expired. Renew membership before check-in.'
      });

    const existing=await query(`
      SELECT id
      FROM attendance_logs
      WHERE gym_id=$1 AND user_id=$2 AND attendance_date=CURRENT_DATE
    `,[gym(req),m.rows[0].id]);

    if(existing.rowCount)
            return res.status(409).json({message:'Member is already checked in'});

    const q=await query(`
      INSERT INTO attendance_logs(
        gym_id,user_id,check_in_method,verified_by
      )
      VALUES($1,$2,$3,$4)
      RETURNING *
    `,[gym(req),m.rows[0].id,d.check_in_method,req.user.id]);

    res.status(201).json({
      log:{
        ...q.rows[0],
        full_name:m.rows[0].full_name,
        member_code:m.rows[0].member_code
      }
    });
  }catch(e){next(e);}
});

r.patch('/attendance/:id/check-out',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const q=await query(`
      UPDATE attendance_logs
      SET check_out_time=NOW()
      WHERE id=$1 AND gym_id=$2 AND check_out_time IS NULL
      RETURNING *
    `,[req.params.id,gym(req)]);

    if(!q.rowCount)
      return res.status(404).json({message:'Open attendance record not found'});

    res.json({log:q.rows[0]});
  }catch(e){next(e);}
});

// Attendance history for one member.
r.get('/members/:id/attendance',auth,async(req,res,next)=>{
  try{
    const member=await query("SELECT id FROM users WHERE id=$1 AND gym_id=$2 AND role='member'",[req.params.id,gym(req)]);
    if(!member.rowCount)return res.status(404).json({message:'Member not found'});
    const q=await query(`SELECT * FROM attendance_logs WHERE gym_id=$1 AND user_id=$2 ORDER BY attendance_date DESC,check_in_time DESC LIMIT 200`,[gym(req),req.params.id]);
    res.json({logs:q.rows,attendance:q.rows});
  }catch(e){next(e);}
});

// Payment records and Razorpay checkout.
const paymentAccess=[auth,moduleGate('payments')];

// Payment history for one member, including the staff member who recorded it.
r.get('/members/:id/payments',...paymentAccess,async(req,res,next)=>{
  try{
    const member=await query("SELECT id FROM users WHERE id=$1 AND gym_id=$2 AND role='member'",[req.params.id,gym(req)]);
    if(!member.rowCount)return res.status(404).json({message:'Member not found'});
    const q=await query(`
      SELECT p.*,u.full_name recorded_by_name
      FROM payments p
      LEFT JOIN users u ON u.id=p.recorded_by AND u.gym_id=p.gym_id
      WHERE p.gym_id=$1 AND p.user_id=$2
      ORDER BY COALESCE(p.paid_at,p.created_at) DESC,p.created_at DESC
      LIMIT 200
    `,[gym(req),req.params.id]);
    res.json({payments:q.rows});
  }catch(e){next(e);}
});

// Only actual payment transactions appear in the Payments page.
// Balance placeholders are not transactions received from a member.
r.get('/payments',...paymentAccess,async(req,res,next)=>{
  try{
    const q=await query(`
      SELECT
        p.*,
        COALESCE(u.full_name,tv.full_name) full_name,
        COALESCE(u.member_code,'TRIAL') member_code
      FROM payments p
      LEFT JOIN users u ON u.id=p.user_id AND u.gym_id=p.gym_id
      LEFT JOIN trial_visitors tv ON tv.id=p.trial_visitor_id AND tv.gym_id=p.gym_id
      WHERE p.gym_id=$1 AND p.entry_type='payment'
      ORDER BY p.created_at DESC
      LIMIT 500
    `,[gym(req)]);

    res.json({payments:q.rows});
  }catch(e){next(e);}
});

// Record a payment against the member's latest membership.
// This does not create or renew a membership.
r.post('/payments',...paymentAccess,authorize('admin','staff'),async(req,res,next)=>{
  const c=await pool.connect();

  try{
    const d=z.object({
      member_id:z.string().uuid(),
      amount:z.coerce.number().positive(),
      payment_method:z.enum([
        'cash','upi','bank_transfer','card','online'
      ]),
      status:z.enum(['paid','pending']).default('paid'),
      description:z.string().optional()
    }).parse(req.body);

    await c.query('BEGIN');

    const member=await c.query(`
      SELECT id
      FROM users
      WHERE id=$1 AND gym_id=$2 AND role='member'
      FOR UPDATE
    `,[d.member_id,gym(req)]);

    if(!member.rowCount)
      throw Object.assign(new Error('Member not found'),{status:404});

    const sub=await c.query(`
      SELECT id,total_amount
      FROM member_subscriptions
      WHERE gym_id=$1 AND user_id=$2
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,[gym(req),d.member_id]);

    if(!sub.rowCount)
      throw Object.assign(
        new Error('This member has no membership'),
        {status:400}
      );

    const subscription=sub.rows[0];

    const paid=await c.query(`
      SELECT COALESCE(SUM(total_amount),0) AS total_paid
      FROM payments
      WHERE gym_id=$1
        AND user_id=$2
        AND subscription_id=$3
        AND entry_type='payment'
        AND status='paid'
    `,[gym(req),d.member_id,subscription.id]);

    const total=Number(subscription.total_amount);
    const received=Number(paid.rows[0].total_paid);
    const outstanding=Math.max(0,total-received);

    if(outstanding<=0)
      throw Object.assign(
        new Error('This membership is already fully paid'),
        {status:400}
      );

    if(d.amount>outstanding)
      throw Object.assign(
        new Error(
          `Amount cannot exceed the outstanding balance of ₹${outstanding.toFixed(2)}`
        ),
        {status:400}
      );

    const payment=await c.query(`
      INSERT INTO payments(
        gym_id,invoice_number,user_id,subscription_id,
        amount,total_amount,payment_method,status,paid_at,
        description,entry_type,recorded_by
      )
      VALUES(
        $1,$2,$3,$4,$5,$5,$6,$7,
        CASE WHEN $7='paid' THEN NOW() ELSE NULL END,
        $8,'payment',$9
      )
      RETURNING *
    `,[
      gym(req),
      invoiceNumber(),
      d.member_id,
      subscription.id,
      d.amount,
      d.payment_method,
      d.status,
      d.description||'Membership payment',
      req.user.id
    ]);

    await c.query('COMMIT');

    res.status(201).json({
      payment:payment.rows[0],
      total_amount:total,
      total_paid:received+(d.status==='paid'?d.amount:0),
      pending_amount:Math.max(
        0,outstanding-(d.status==='paid'?d.amount:0)
      )
    });
  }catch(e){
    await c.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{c.release();}
});

// Create a Razorpay link only for the outstanding balance
// of the member's existing latest membership.
r.post('/payments/link',...paymentAccess,authorize('admin','staff'),async(req,res,next)=>{
  const c=await pool.connect();

  try{
    const d=z.object({
      member_id:z.string().uuid(),
      amount:z.coerce.number().positive(),
      description:z.string().optional()
    }).parse(req.body);

    const enabled=await query(`
      SELECT enabled
      FROM gym_modules
      WHERE gym_id=$1 AND module_key='online_payments'
    `,[gym(req)]);

    if(!enabled.rowCount||!enabled.rows[0].enabled)
      throw Object.assign(
        new Error('Enable online payments in Settings first'),
        {status:403}
      );

    const cfg=await integration(gym(req),'razorpay');

    if(!cfg)
      throw Object.assign(
        new Error('Configure Razorpay in Settings first'),
        {status:409}
      );

    await c.query('BEGIN');

    const member=await c.query(`
      SELECT id,full_name,phone,email,whatsapp_opt_in
      FROM users
      WHERE id=$1 AND gym_id=$2 AND role='member'
      FOR UPDATE
    `,[d.member_id,gym(req)]);

    if(!member.rowCount)
      throw Object.assign(new Error('Member not found'),{status:404});

    const sub=await c.query(`
      SELECT id,total_amount
      FROM member_subscriptions
      WHERE gym_id=$1 AND user_id=$2
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,[gym(req),d.member_id]);

    if(!sub.rowCount)
      throw Object.assign(
        new Error('This member has no membership'),
        {status:400}
      );

    const subscription=sub.rows[0];

    const paid=await c.query(`
      SELECT COALESCE(SUM(total_amount),0) total_paid
      FROM payments
      WHERE gym_id=$1
        AND user_id=$2
        AND subscription_id=$3
        AND entry_type='payment'
        AND status='paid'
    `,[gym(req),d.member_id,subscription.id]);

    const total=Number(subscription.total_amount);
    const received=Number(paid.rows[0].total_paid);
    const outstanding=Math.max(0,total-received);
    const amount=Math.round(d.amount*100)/100;

    if(outstanding<=0)
      throw Object.assign(
        new Error('This membership is already fully paid'),
        {status:400}
      );

    if(amount>outstanding)
      throw Object.assign(
        new Error(
          `Amount cannot exceed the outstanding balance of ₹${outstanding.toFixed(2)}`
        ),
        {status:400}
      );

    // Prevent duplicate active links for this membership.
    const existing=await c.query(`
      SELECT po.id
      FROM payment_orders po
      JOIN payments p
        ON p.id=po.payment_id AND p.gym_id=po.gym_id
      WHERE po.gym_id=$1
        AND p.subscription_id=$2
        AND po.status='pending'
        AND p.status='pending'
      LIMIT 1
    `,[gym(req),subscription.id]);

    if(existing.rowCount)
      throw Object.assign(
        new Error('A payment link is already pending for this membership. Wait until it is paid or expires before creating another.'),
        {status:409}
      );

    const resp=await fetch(
      'https://api.razorpay.com/v1/payment_links',
      {
        method:'POST',
        headers:{
          Authorization:`Basic ${Buffer.from(
            `${cfg.keyId}:${cfg.keySecret}`
          ).toString('base64')}`,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          amount:Math.round(amount*100),
          currency:'INR',
          description:d.description||'Gym membership payment',
          customer:{
            name:member.rows[0].full_name,
            contact:member.rows[0].phone,
            email:member.rows[0].email||undefined
          },
          notify:{sms:false,email:false},
          reminder_enable:true,
          expire_by:Math.floor(Date.now()/1000)+86400
        })
      }
    );

    const link=await resp.json();

    if(!resp.ok)
      throw Object.assign(
        new Error(link.error?.description||'Payment link creation failed'),
        {status:502}
      );

    const p=(await c.query(`
      INSERT INTO payments(
        gym_id,invoice_number,user_id,subscription_id,
        amount,total_amount,payment_method,status,paid_at,
        description,entry_type,recorded_by
      )
      VALUES(
        $1,$2,$3,$4,$5,$5,'online','pending',NULL,
        $6,'payment',$7
      )
      RETURNING id
    `,[
      gym(req),
      invoiceNumber(),
      d.member_id,
      subscription.id,
      amount,
      d.description||'Online membership payment',
      req.user.id
    ])).rows[0];

    await c.query(`
      INSERT INTO payment_orders(
        gym_id,payment_id,provider_order_id,amount_paise
      )
      VALUES($1,$2,$3,$4)
    `,[
      gym(req),p.id,link.id,Math.round(amount*100)
    ]);

    await c.query('COMMIT');

    let whatsappSent=false;

    try{
      const waModule=await query(`
        SELECT enabled
        FROM gym_modules
        WHERE gym_id=$1 AND module_key='whatsapp'
      `,[gym(req)]);

      const wa=waModule.rows[0]?.enabled
        ?await integration(gym(req),'whatsapp'):null;

      if(wa?.paymentLinkTemplate&&member.rows[0].whatsapp_opt_in){
        const messageId=await sendWhatsApp(
          gym(req),
          member.rows[0].phone,
          wa.paymentLinkTemplate,
          [
            member.rows[0].full_name,
            link.short_url,
            String(amount)
          ]
        );

        await logNotification(
                    gym(req),member.rows[0].phone,
          'payment_link',p.id,'sent',null,messageId
        );

        whatsappSent=true;
      }
    }catch(e){
      await logNotification(
        gym(req),member.rows[0].phone,
        'payment_link',p.id,'failed',e.message,null
      );
    }

    res.status(201).json({
      payment_id:p.id,
      short_url:link.short_url,
      amount,
      total_amount:total,
      total_paid:received,
      pending_amount:outstanding,
      whatsapp_sent:whatsappSent
    });

  }catch(e){
    await c.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{c.release();}
});

// Mark an existing pending payment as paid.
// Does not create a new payment or membership.
r.patch('/payments/:id/mark-paid',...paymentAccess,authorize('admin','staff'),async(req,res,next)=>{
  const c=await pool.connect();

  try{
    const d=z.object({
      payment_method:z.enum([
        'cash','upi','bank_transfer','card','online'
      ]).default('cash')
    }).parse(req.body);

    await c.query('BEGIN');

    const p=await c.query(`
      SELECT *
      FROM payments
      WHERE id=$1 AND gym_id=$2
        AND status='pending'
        AND entry_type='payment'
      FOR UPDATE
    `,[req.params.id,gym(req)]);

    if(!p.rowCount)
      throw Object.assign(
        new Error('Pending payment not found'),
        {status:404}
      );

    const payment=p.rows[0];

    if(payment.subscription_id){
      const sub=await c.query(`
        SELECT id,total_amount
        FROM member_subscriptions
        WHERE id=$1 AND gym_id=$2
        FOR UPDATE
      `,[payment.subscription_id,gym(req)]);

      if(!sub.rowCount)
        throw Object.assign(new Error('Membership not found'),{status:404});

      const paid=await c.query(`
        SELECT COALESCE(SUM(total_amount),0) total_paid
        FROM payments
        WHERE gym_id=$1
          AND subscription_id=$2
          AND entry_type='payment'
          AND status='paid'
          AND id<>$3
      `,[gym(req),payment.subscription_id,payment.id]);

      const outstanding=Math.max(
        0,
        Number(sub.rows[0].total_amount)-
        Number(paid.rows[0].total_paid)
      );

      if(Number(payment.total_amount)>outstanding)
        throw Object.assign(
          new Error('This payment exceeds the remaining membership balance'),
          {status:400}
        );
    }

    const updated=await c.query(`
      UPDATE payments
      SET status='paid',
          payment_method=$1,
          paid_at=NOW(),
          recorded_by=$2
      WHERE id=$3 AND gym_id=$4
      RETURNING *
    `,[
      d.payment_method,
      req.user.id,
      payment.id,
      gym(req)
    ]);

    await c.query(`
      UPDATE payment_orders
      SET status='paid'
      WHERE payment_id=$1 AND gym_id=$2
    `,[payment.id,gym(req)]);

    await c.query('COMMIT');
    res.json({payment:updated.rows[0]});

  }catch(e){
    await c.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{c.release();}
});

// Record a partial payment against an existing pending invoice.
// Preserves original membership price, creates an immutable payment record,
// never creates duplicate memberships, prevents payment above outstanding balance,
// and ensures gym data isolation.
r.post('/payments/:id/partial',...paymentAccess,authorize('admin','staff'),async(req,res,next)=>{
  const c=await pool.connect();
  try{
    const d=z.object({
      amount:z.coerce.number().positive(),
      payment_method:z.enum(['cash','upi','bank_transfer','card','online'])
    }).parse(req.body);

    await c.query('BEGIN');

    // 1. Lock and retrieve the pending invoice scoped to the authenticated gym
    const q=await c.query(
      `SELECT * FROM payments
       WHERE id=$1 AND gym_id=$2 AND status='pending' AND entry_type='payment'
       FOR UPDATE`,
      [req.params.id,gym(req)]
    );

    if(!q.rowCount){
      await c.query('ROLLBACK');
      return res.status(404).json({message:'Pending payment not found'});
    }

    const invoice=q.rows[0];
    const invoiceOutstanding=Number(invoice.total_amount);

    if(d.amount>invoiceOutstanding){
      await c.query('ROLLBACK');
      return res.status(400).json({
        message:`Amount cannot exceed pending invoice balance of ₹${invoiceOutstanding.toFixed(2)}`
      });
    }

    // 2. If tied to a membership subscription, lock and verify against overall subscription balance
    if(invoice.subscription_id){
      const sub=await c.query(
        `SELECT id,total_amount FROM member_subscriptions
         WHERE id=$1 AND gym_id=$2
         FOR UPDATE`,
        [invoice.subscription_id,gym(req)]
      );

      if(!sub.rowCount){
        await c.query('ROLLBACK');
        return res.status(404).json({message:'Membership not found'});
      }

      const paid=await c.query(
        `SELECT COALESCE(SUM(total_amount),0) total_paid
         FROM payments
         WHERE gym_id=$1 AND subscription_id=$2 AND entry_type='payment' AND status='paid'`,
        [gym(req),invoice.subscription_id]
      );

      const maxRemaining=Math.max(0,Number(sub.rows[0].total_amount)-Number(paid.rows[0].total_paid));
      if(d.amount>maxRemaining){
        await c.query('ROLLBACK');
        return res.status(400).json({
          message:`Amount exceeds remaining membership balance of ₹${maxRemaining.toFixed(2)}`
        });
      }
    }

    const remaining=Number((invoiceOutstanding-d.amount).toFixed(2));

    // 3. Insert immutable receipt for the actual received payment transaction
    const received=await c.query(
      `INSERT INTO payments(
        gym_id,invoice_number,user_id,subscription_id,trial_visitor_id,
        amount,total_amount,payment_method,status,paid_at,
        description,entry_type,recorded_by
      )
      VALUES($1,$2,$3,$4,$5,$6,$6,$7,'paid',NOW(),$8,'payment',$9)
      RETURNING *`,
      [
        gym(req),
        invoiceNumber(),
        invoice.user_id,
        invoice.subscription_id,
        invoice.trial_visitor_id,
        d.amount,
        d.payment_method,
        `Partial payment against invoice ${invoice.invoice_number}`,
        req.user.id
      ]
    );

    // 4. Update the pending invoice balance; if fully satisfied (remaining === 0), mark as paid
    const updated=await c.query(
      `UPDATE payments
       SET amount=$1,
           total_amount=$1,
           status=CASE WHEN $1=0 THEN 'paid' ELSE 'pending' END,
           paid_at=CASE WHEN $1=0 THEN NOW() ELSE NULL END,
           recorded_by=CASE WHEN $1=0 THEN $4 ELSE recorded_by END
       WHERE id=$2 AND gym_id=$3 AND status='pending'
       RETURNING *`,
      [remaining,invoice.id,gym(req),req.user.id]
    );

    // 5. If this invoice had an associated Razorpay order and is now fully settled, mark payment_orders paid
    if(remaining===0){
      await c.query(
        `UPDATE payment_orders SET status='paid' WHERE payment_id=$1 AND gym_id=$2`,
        [invoice.id,gym(req)]
      );
    }

    await c.query('COMMIT');

    res.status(201).json({
      message:remaining===0?'Payment completed successfully':'Partial payment recorded successfully',
      payment:received.rows[0],
      outstanding:updated.rows[0]
    });
  }catch(e){
    await c.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{
    c.release();
  }
});

// Razorpay webhook.
r.post('/payments/razorpay-webhook',async(req,res)=>{
  try{
    const g=req.query.gym;
    if(!g)return res.status(400).send('Missing gym');

    const cfg=await integration(g,'razorpay');
    if(!cfg)return res.status(404).send('Not configured');

    const sig=req.headers['x-razorpay-signature'];
    const expected=crypto.createHmac('sha256',cfg.webhookSecret)
      .update(req.rawBody||JSON.stringify(req.body))
      .digest('hex');

    if(!safeEqual(sig,expected))
      return res.status(400).send('Invalid signature');

    const ev=req.body;
    let providerOrderId=null;

    if(ev.event==='payment_link.paid')
      providerOrderId=ev.payload?.payment_link?.entity?.id;

    if(ev.event==='payment.captured')
      providerOrderId=ev.payload?.payment?.entity?.order_id;

    if(providerOrderId)
      await reconcilePayment(g,providerOrderId);

    res.json({received:true});
  }catch(e){
    console.error('Razorpay webhook error:',e.message);
    res.status(500).json({message:'Webhook processing failed'});
  }
});
// Expenses and trial visitors.
r.get('/finance/expenses',auth,async(req,res,next)=>{
  try{
    const q=await query(`
      SELECT *
      FROM expenses
      WHERE gym_id=$1
      ORDER BY expense_date DESC,created_at DESC
      LIMIT 500
    `,[gym(req)]);

    res.json({expenses:q.rows});
  }catch(e){next(e);}
});

r.post('/finance/expenses',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const d=z.object({
      category:z.string().min(2),
      description:z.string().min(2),
      amount:z.coerce.number().positive(),
      expense_date:z.string().optional(),
      status:z.enum(['paid','pending']).default('paid')
    }).parse(req.body);

    const q=await query(`
      INSERT INTO expenses(
        gym_id,category,description,amount,expense_date,status
      )
      VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6)
      RETURNING *
    `,[
      gym(req),d.category,d.description,d.amount,
      d.expense_date||null,d.status
    ]);

    res.status(201).json({expense:q.rows[0]});
  }catch(e){next(e);}
});

r.get('/trials',auth,async(req,res,next)=>{
  try{
    res.json({
      trials:(await query(`
        SELECT tv.*,mp.name plan_name
        FROM trial_visitors tv
        LEFT JOIN membership_plans mp
          ON mp.id=tv.interested_plan_id AND mp.gym_id=tv.gym_id
        WHERE tv.gym_id=$1
        ORDER BY tv.created_at DESC
      `,[gym(req)])).rows
    });
  }catch(e){next(e);}
});

r.patch('/trials/:id',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const d=z.object({whatsapp_opt_in:z.boolean()}).parse(req.body);

    const q=await query(`
      UPDATE trial_visitors
      SET whatsapp_opt_in=$1,
          whatsapp_opt_in_at=CASE
            WHEN $1 THEN COALESCE(whatsapp_opt_in_at,NOW())
            ELSE NULL
          END
      WHERE id=$2 AND gym_id=$3
      RETURNING id,whatsapp_opt_in
    `,[d.whatsapp_opt_in,req.params.id,gym(req)]);

    if(!q.rowCount)
      return res.status(404).json({message:'Trial visitor not found'});

    res.json({trial:q.rows[0]});
  }catch(e){next(e);}
});

r.post('/trials',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const d=z.object({
      full_name:z.string().min(2),
      phone:z.string().min(7).refine(
        v=>phoneValue(v).length>=10,'Enter a valid phone number'
      ),
      email:z.string().email().optional().or(z.literal('')),
      duration_days:z.coerce.number().int().min(1).max(30).optional(),
      plan_id:z.string().uuid().optional(),
      notes:z.string().optional(),
      whatsapp_opt_in:z.boolean().default(false)
    }).parse(req.body);

    if(d.plan_id){
      const p=await query(`
        SELECT id
        FROM membership_plans
        WHERE id=$1 AND gym_id=$2 AND is_active=true
      `,[d.plan_id,gym(req)]);

      if(!p.rowCount)
        return res.status(404).json({message:'Membership plan not found'});
    }

    const trialDays=d.duration_days||Number(
      (await query(
        'SELECT settings FROM gym_settings WHERE gym_id=$1',
        [gym(req)]
      )).rows[0]?.settings?.trial_duration_days||3
    );

    const q=await query(`
      INSERT INTO trial_visitors(
        gym_id,full_name,phone,email,end_at,notes,
        interested_plan_id,whatsapp_opt_in,whatsapp_opt_in_at
      )
      VALUES(
        $1,$2,$3,$4,NOW()+($5 * INTERVAL '1 day'),
        $6,$7,$8,CASE WHEN $8 THEN NOW() ELSE NULL END
      )
      RETURNING *
    `,[
      gym(req),d.full_name,phoneValue(d.phone),
      d.email||null,trialDays,d.notes||null,
      d.plan_id||null,d.whatsapp_opt_in
    ]);

    res.status(201).json({trial:q.rows[0]});
  }catch(e){next(e);}
});

// Member QR attendance: request WhatsApp OTP.
r.post('/public/:slug/otp',async(req,res,next)=>{
  try{
    const d=z.object({
      phone:z.string().min(7).refine(
        v=>phoneValue(v).length>=10,'Enter a valid phone number'
      )
    }).parse(req.body);

    const g=await query(
      "SELECT id FROM gyms WHERE slug=$1 AND status='active'",
      [req.params.slug]
    );

    if(!g.rowCount)
      return res.status(404).json({message:'Gym not found'});

    const att=await query(`
      SELECT enabled
      FROM gym_modules
      WHERE gym_id=$1 AND module_key='attendance'
    `,[g.rows[0].id]);

    if(!att.rows[0]?.enabled)
      return res.status(403).json({
        message:'Member attendance is disabled for this gym'
      });

    const m=await query(`
      SELECT id,status,full_name
      FROM users
      WHERE gym_id=$1 AND phone=$2 AND role='member'
    `,[g.rows[0].id,phoneValue(d.phone)]);

    if(!m.rowCount||m.rows[0].status!=='active')
      return res.status(404).json({
        message:'No active member found with this phone number'
      });

    const recent=await query(`
      SELECT COUNT(*)::int n
      FROM otp_challenges
      WHERE gym_id=$1 AND phone=$2
        AND created_at>NOW()-INTERVAL '15 minutes'
    `,[g.rows[0].id,phoneValue(d.phone)]);

    if(recent.rows[0].n>=3)
      return res.status(429).json({
        message:'Too many OTP requests. Please wait 15 minutes.'
      });

    const code=String(crypto.randomInt(100000,1000000));

    await query(`
      INSERT INTO otp_challenges(gym_id,phone,code_hash,expires_at)
      VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes')
    `,[g.rows[0].id,phoneValue(d.phone),hash(code)]);

    const wm=await query(`
      SELECT enabled
      FROM gym_modules
      WHERE gym_id=$1 AND module_key='whatsapp'
    `,[g.rows[0].id]);

    const cfg=wm.rows[0]?.enabled
      ?await integration(g.rows[0].id,'whatsapp'):null;

    if(!cfg){
      if(env.nodeEnv==='production')
        return res.status(503).json({
          message:'Gym has not configured WhatsApp OTP delivery'
        });

      return res.json({
        message:'Development OTP generated. Use the code shown below.',
        development_otp:code
      });
    }

    try{
      await sendWhatsApp(
        g.rows[0].id,
        phoneValue(d.phone),
        cfg.otpTemplate,
        [code]
      );
    }catch(e){
      return res.status(502).json({
        message:`OTP could not be delivered: ${e.message}`
      });
    }

    res.json({message:'OTP sent to your WhatsApp'});
  }catch(e){next(e);}
});

// Verify OTP and mark attendance.
r.post('/public/:slug/verify-checkin',async(req,res,next)=>{
  const c=await pool.connect();

  try{
    const d=z.object({
      phone:z.string().min(7).refine(
        v=>phoneValue(v).length>=10,'Enter a valid phone number'
      ),
      otp:z.string().length(6)
    }).parse(req.body);

    const g=await c.query(
      "SELECT id FROM gyms WHERE slug=$1 AND status='active'",
      [req.params.slug]
    );
        if(!g.rowCount)
      return res.status(404).json({message:'Gym not found'});

    const gymId=g.rows[0].id;

    const att=await c.query(`
      SELECT enabled
      FROM gym_modules
      WHERE gym_id=$1 AND module_key='attendance'
    `,[gymId]);

    if(!att.rows[0]?.enabled)
      return res.status(403).json({
        message:'Member attendance is disabled for this gym'
      });

    const m=await c.query(`
      SELECT id,status,full_name
      FROM users
      WHERE gym_id=$1 AND phone=$2 AND role='member'
    `,[gymId,phoneValue(d.phone)]);

    if(!m.rowCount||m.rows[0].status!=='active')
      return res.status(404).json({
        message:'Member not found or inactive'
      });

    const o=await c.query(`
      SELECT *
      FROM otp_challenges
      WHERE gym_id=$1 AND phone=$2
        AND consumed_at IS NULL
        AND expires_at>NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `,[gymId,phoneValue(d.phone)]);

    if(!o.rowCount)
      return res.status(400).json({
        message:'OTP expired. Request a new code.'
      });

    if(o.rows[0].attempts>=5)
      return res.status(429).json({
        message:'Too many incorrect attempts. Request a new OTP.'
      });

    if(!safeEqual(o.rows[0].code_hash,hash(d.otp))){
      await c.query(
        'UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1',
        [o.rows[0].id]
      );
      return res.status(400).json({message:'Incorrect OTP'});
    }

    const used=await c.query(`
      UPDATE otp_challenges
      SET consumed_at=NOW()
      WHERE id=$1 AND consumed_at IS NULL
      RETURNING id
    `,[o.rows[0].id]);

    if(!used.rowCount)
      return res.status(409).json({
        message:'OTP already used. Request a new code.'
      });

    const active=await c.query(`
      SELECT id
      FROM member_subscriptions
      WHERE gym_id=$1 AND user_id=$2
        AND status='active' AND end_date>=CURRENT_DATE
      ORDER BY end_date DESC
      LIMIT 1
    `,[gymId,m.rows[0].id]);

    if(!active.rowCount)
      return res.status(403).json({
        message:'Membership expired. Please contact the gym owner.'
      });

    const duplicate=await c.query(`
      SELECT id
      FROM attendance_logs
      WHERE gym_id=$1 AND user_id=$2 AND attendance_date=CURRENT_DATE
    `,[gymId,m.rows[0].id]);

    if(duplicate.rowCount)
      return res.status(409).json({
        message:'Your attendance is already marked for today'
      });

    const a=await c.query(`
      INSERT INTO attendance_logs(gym_id,user_id,check_in_method)
      VALUES($1,$2,'qr_code')
      RETURNING check_in_time
    `,[gymId,m.rows[0].id]);

    res.json({
      message:'Attendance marked successfully',
      check_in_time:a.rows[0].check_in_time,
      member_name:m.rows[0].full_name
    });
  }catch(e){
    next(e);
  }finally{c.release();}
});

// Trainer and equipment CRUD.
r.get('/trainers',auth,async(req,res,next)=>{
  try{
    res.json({
      trainers:(await query(`
        SELECT t.*,u.full_name,u.phone,u.email
        FROM trainers t
        JOIN users u ON u.id=t.user_id AND u.gym_id=t.gym_id
        WHERE t.gym_id=$1
      `,[gym(req)])).rows
    });
  }catch(e){next(e);}
});

r.post('/trainers',auth,authorize('admin','staff'),async(req,res,next)=>{
  const c=await pool.connect();

  try{
    const d=z.object({
      full_name:z.string().min(2),
      phone:z.string().min(7).refine(
        v=>phoneValue(v).length>=10,'Enter a valid phone number'
      ),
      email:z.string().email(),
      specialty:z.string().min(2),
      experience_years:z.coerce.number().int().min(0).default(1),
      hourly_rate:z.coerce.number().nonnegative().default(0),
      certifications:z.array(z.string()).default([]),
      bio:z.string().optional()
    }).parse(req.body);

    await c.query('BEGIN');

    const u=(await c.query(`
      INSERT INTO users(
        gym_id,member_code,full_name,email,password_hash,phone,role,status
      )
      VALUES($1,$2,$3,$4,$5,$6,'trainer','active')
      RETURNING id
    `,[
      gym(req),memberCode('TR'),d.full_name,d.email,
      await bcrypt.hash(crypto.randomBytes(24).toString('hex'),10),
      phoneValue(d.phone)
    ])).rows[0];

    const t=(await c.query(`
      INSERT INTO trainers(
        gym_id,user_id,specialty,experience_years,
        hourly_rate,certifications,bio
      )
      VALUES($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `,[
      gym(req),u.id,d.specialty,d.experience_years,
      d.hourly_rate,d.certifications,d.bio||null
    ])).rows[0];

    await c.query('COMMIT');

    res.status(201).json({
      trainer:{
        ...t,
        full_name:d.full_name,
        phone:phoneValue(d.phone)
      }
    });
  }catch(e){
    await c.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{c.release();}
});

r.get('/equipment',auth,async(req,res,next)=>{
  try{
    res.json({
      equipment:(await query(
        'SELECT * FROM equipment WHERE gym_id=$1 ORDER BY name',
        [gym(req)]
      )).rows
    });
  }catch(e){next(e);}
});

r.post('/equipment',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const d=z.object({
      asset_code:z.string().min(2),
      name:z.string().min(2),
      category:z.string().min(2),
      brand:z.string().optional(),
      zone:z.string().default('Main Floor')
    }).parse(req.body);

    const q=await query(`
      INSERT INTO equipment(
        gym_id,asset_code,name,category,brand,zone
      )
      VALUES($1,$2,$3,$4,$5,$6)
      RETURNING *
    `,[
      gym(req),d.asset_code,d.name,d.category,
      d.brand||null,d.zone
    ]);

    res.status(201).json({equipment:q.rows[0]});
  }catch(e){next(e);}
});

r.patch('/equipment/:id',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const d=z.object({
      status:z.enum([
        'operational','maintenance_needed','out_of_order'
      ]).optional(),
      notes:z.string().optional(),
      next_maintenance_date:z.string().optional()
    }).parse(req.body);

    const q=await query(`
      UPDATE equipment
      SET status=COALESCE($1,status),
          notes=COALESCE($2,notes),
          next_maintenance_date=COALESCE($3::date,next_maintenance_date)
      WHERE id=$4 AND gym_id=$5
      RETURNING *
    `,[
      d.status,d.notes,d.next_maintenance_date||null,
      req.params.id,gym(req)
    ]);

    if(!q.rowCount)
      return res.status(404).json({message:'Equipment not found'});

    res.json({equipment:q.rows[0]});
  }catch(e){next(e);}
});

// Classes and bookings.
r.get('/classes',auth,async(req,res,next)=>{
  try{
    const q=await query(`
      SELECT
        c.*,t.id trainer_profile_id,u.full_name trainer_name,
        (
          SELECT COUNT(*)::int
          FROM class_bookings b
          WHERE b.gym_id=c.gym_id
            AND b.class_id=c.id
            AND b.status='confirmed'
            AND b.booking_date=CURRENT_DATE
        ) booked_count
      FROM fitness_classes c
      LEFT JOIN trainers t
        ON t.id=c.trainer_id AND t.gym_id=c.gym_id
      LEFT JOIN users u
        ON u.id=t.user_id AND u.gym_id=t.gym_id
      WHERE c.gym_id=$1
      ORDER BY c.day_of_week,c.start_time
    `,[gym(req)]);

    res.json({classes:q.rows});
  }catch(e){next(e);}
});

r.post('/classes',auth,authorize('admin','staff'),async(req,res,next)=>{
  try{
    const d=z.object({
      title:z.string().min(2),
      description:z.string().optional(),
      category:z.string().default('Strength'),
      trainer_id:z.string().uuid().optional().or(z.literal('')),
      room:z.string().default('Main Floor'),
      day_of_week:z.enum([
        'Monday','Tuesday','Wednesday','Thursday',
        'Friday','Saturday','Sunday'
      ]),
      start_time:z.string(),
      end_time:z.string(),
      capacity:z.coerce.number().int().positive().default(20),
      difficulty_level:z.enum([
        'Beginner','Intermediate','Advanced','All Levels'
      ]).default('All Levels')
    }).parse(req.body);

    if(d.trainer_id){
      const t=await query(
        'SELECT id FROM trainers WHERE id=$1 AND gym_id=$2',
        [d.trainer_id,gym(req)]
      );
      if(!t.rowCount)
        return res.status(404).json({message:'Trainer not found'});
    }

    const q=await query(`
      INSERT INTO fitness_classes(
        gym_id,title,description,category,trainer_id,room,
        day_of_week,start_time,end_time,capacity,difficulty_level
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `,[
      gym(req),d.title,d.description||null,d.category,
      d.trainer_id||null,d.room,d.day_of_week,
      d.start_time,d.end_time,d.capacity,d.difficulty_level
    ]);

    res.status(201).json({class:q.rows[0]});
  }catch(e){next(e);}
});

r.get('/classes/my-bookings',auth,async(req,res,next)=>{
  try{
    res.json({bookings:[]});
  }catch(e){next(e);}
});

r.post('/classes/:id/book',auth,async(req,res,next)=>{
  try{
    if(req.user.role!=='member')
      return res.status(403).json({message:'Member account required'});

    const c=await query(`
      SELECT *
      FROM fitness_classes
      WHERE id=$1 AND gym_id=$2 AND status='scheduled'
    `,[req.params.id,gym(req)]);

    if(!c.rowCount)
      return res.status(404).json({message:'Class not found'});

    const n=await query(`
      SELECT COUNT(*)::int n
      FROM class_bookings
      WHERE gym_id=$1 AND class_id=$2
        AND booking_date=CURRENT_DATE AND status='confirmed'
    `,[gym(req),req.params.id]);

    const status=n.rows[0].n>=c.rows[0].capacity
      ?'waitlisted':'confirmed';

    const b=await query(`
      INSERT INTO class_bookings(gym_id,class_id,user_id,status)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(class_id,user_id,booking_date)
      DO UPDATE SET status=EXCLUDED.status
      RETURNING *
    `,[gym(req),req.params.id,req.user.id,status]);

    res.status(201).json({booking:b.rows[0]});
  }catch(e){next(e);}
});

r.delete('/classes/:id/book',auth,async(req,res,next)=>{
  try{
    const q=await query(`
      UPDATE class_bookings
      SET status='cancelled'
      WHERE gym_id=$1 AND class_id=$2
        AND user_id=$3 AND booking_date=CURRENT_DATE
      RETURNING *
    `,[gym(req),req.params.id,req.user.id]);

    res.json({cancelled:!!q.rowCount});
  }catch(e){next(e);}
});

export default r;
