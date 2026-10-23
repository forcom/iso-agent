import app from './index';
import {tickResearch} from './research/runner';
import type {Env} from './types';
export default {
 fetch:app.fetch,
 async scheduled(controller:ScheduledController,env:Env){
  if(env.RESEARCH_SCHEDULES_ENABLED==='true')await tickResearch(env,new Date(controller.scheduledTime).toISOString());
 }
};
export {PyreWireEngine} from './containers';
