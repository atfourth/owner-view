import crypto from 'crypto';
import {env} from '../config/env.js';
const key=crypto.createHash('sha256').update(env.encryptionKey||env.jwtSecret).digest();
export function encrypt(value){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64');}
export function decrypt(value){const b=Buffer.from(value,'base64');const d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'));}
export function hash(value){return crypto.createHmac('sha256',env.jwtSecret).update(String(value)).digest('hex');}
export function safeEqual(a,b){if(!a||!b)return false;const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
