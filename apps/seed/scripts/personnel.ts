import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {provisionFictionalPersonnel,type FictionalPersonnelInput} from '../../worker/src/lib/personnel';
import {installationEnvironment,openInstallationPlatform} from './deployment';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const {values}=parseArgs({options:{environment:{type:'string'}},strict:true});
const environment=installationEnvironment(values.environment);
const input=JSON.parse(await readFile(resolve(root,'apps/seed/inputs/aidu-personnel.json'),'utf8')) as FictionalPersonnelInput;
const files=[['company_profile','docs/aidu-company-profile.md','회사소개서'],['personas','docs/aidu-personas.md','구성원 페르소나'],['assignment_configuration','docs/aidu-erp-personnel.md','ERP 구성원·역할 구성표']] as const;
input.sources=await Promise.all(files.map(async([kind,path,title])=>({kind,path,title,markdown:await readFile(resolve(root,path),'utf8')})));
const platform=await openInstallationPlatform(root,environment);
try{const result={...await provisionFictionalPersonnel(platform.env,input),environment};await writeFile(resolve(platform.reportDirectory,'personnel-report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))}finally{await platform.dispose()}
