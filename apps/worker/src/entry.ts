import app from './index';
import {tickResearch} from './research/runner';
import type {Env} from './types';
export default {
 fetch:app.fetch,
 async scheduled(controller:ScheduledController,env:Env){
  const now=new Date(controller.scheduledTime).toISOString();
  if(env.RESEARCH_SCHEDULES_ENABLED==='true')await tickResearch(env,now);
  if(env.DOTS_ENABLED==='true'){const {dispatchResearchJobs}=await import('./research/events');await dispatchResearchJobs(env,now)}
 }
};
export {PyreWireEngine} from './containers';
