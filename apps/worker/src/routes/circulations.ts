import {Hono} from 'hono';
import type {AppEnv} from '../types';
import {all} from '../lib/storage';
import {createCirculation,confirmReceipt,type Circulation} from '../lib/circulations';
export const circulationRoutes=new Hono<AppEnv>();
circulationRoutes.post('/revisions/:id/circulations',async c=>c.json(await createCirculation(c.env,c.get('actor'),{...await c.req.json(),revisionId:c.req.param('id')}),201));
circulationRoutes.post('/circulations/:id/receipts',async c=>c.json(await confirmReceipt(c.env,c.get('actor'),{...await c.req.json(),circulationId:c.req.param('id')})));
circulationRoutes.get('/circulations',async c=>{
 const receipts=await all<any>(c.env,'receipts');const person=c.get('actor').personId;
 return c.json({items:(await all<Circulation>(c.env,'circulations')).filter(i=>c.req.query('all')==='true'||i.recipientIds.includes(person)).map(i=>({...i,receipts:receipts.filter(r=>r.circulationId===i.id),isRecipient:i.recipientIds.includes(person)}))});
});
