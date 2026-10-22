import {canonical} from '../../../packages/knowledge/src/index';
import {sha256} from './markdown';
export function requestHash(operation:string,payload:unknown){return sha256(canonical({operation,payload}));}
