import {timingSafeEqual} from 'node:crypto';
import type {Env} from '../types';
import {sha256} from '../lib/markdown';
export function equalSecret(a:string,b:string){const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);return x.length===y.length&&timingSafeEqual(x,y)}
export const credentialVersion=(env:Env)=>sha256(env.DOTS_PAIRING_SECRET!);
async function key(env:Env){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.DOTS_PAIRING_SECRET!)),{name:'AES-GCM'},false,['encrypt','decrypt'])}
export async function sealSecret(env:Env,secret:string){
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),new TextEncoder().encode(secret));
 return `${Buffer.from(iv).toString('base64')}.${Buffer.from(cipher).toString('base64')}`;
}
export async function openSecret(env:Env,sealed:string){const [iv,data]=sealed.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},await key(env),Buffer.from(data,'base64')))}
