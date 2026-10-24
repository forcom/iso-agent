import {afterEach,expect,it,vi} from 'vitest';
import {OpenAiProvider} from '../../packages/llm/src/index';

afterEach(()=>vi.restoreAllMocks());
function requestBody(){
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'Synthetic response'}}]}),{status:200}));
 return ()=>JSON.parse(String(fetch.mock.calls[0][1]?.body));
}
it('uses low reasoning without incompatible sampling parameters for the configured reasoning model',async()=>{
 const body=requestBody();await expect(new OpenAiProvider('synthetic-key').complete([{role:'user',content:'Synthetic source comparison'}],{temperature:0})).resolves.toBe('Synthetic response');
 expect(body()).toMatchObject({model:'gpt-5.4',reasoning_effort:'low'});expect(body()).not.toHaveProperty('temperature');
});
it('preserves explicit sampling for a non-reasoning model override',async()=>{
 const body=requestBody();await new OpenAiProvider('synthetic-key').complete([{role:'user',content:'Synthetic question'}],{model:'gpt-4.1',temperature:0});
 expect(body()).toMatchObject({model:'gpt-4.1',temperature:0});expect(body()).not.toHaveProperty('reasoning_effort');
});
