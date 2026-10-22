import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { applyRoleAssignment, listRoleAssignments } from '../lib/assignments';
export const assignmentRoutes=new Hono<AppEnv>();
assignmentRoutes.get('/admin/role-assignments',async c=>c.json(await listRoleAssignments(c.env,c.get('actor'))));
assignmentRoutes.post('/admin/role-assignments/apply',async c=>c.json(await applyRoleAssignment(c.env,c.get('actor'),await c.req.json()),201));
