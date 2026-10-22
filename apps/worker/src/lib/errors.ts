export class ApiError extends Error {
  constructor(public status:number, public code:string, message:string, public details?:unknown) { super(message); }
}
export function requireValue(condition:unknown, status:number, code:string, message:string): asserts condition {
  if (!condition) throw new ApiError(status,code,message);
}
export function textField(value:unknown, name:string, max=500):string {
  requireValue(typeof value==='string' && value.trim().length>0 && value.length<=max,422,'INVALID_INPUT',`${name} 값을 확인해 주세요.`);
  return value.trim();
}
export function stringList(value:unknown, name:string):string[] {
  requireValue(Array.isArray(value) && value.every(v=>typeof v==='string' && v.length>0 && v.length<=200),422,'INVALID_INPUT',`${name} 목록을 확인해 주세요.`);
  return [...new Set(value)];
}
