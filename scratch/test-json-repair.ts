import { repairJson, extractJsonObject } from '../shared/parsing-utils';

function testRepair() {
  const cases = [
    {
      name: 'incomplete unicode',
      input: '{"path": "C:\\Users\\Mahdi", "data": "\\u12" }',
      expected: '{"path": "C:UsersMahdi", "data": "u12" }' 
    },
    {
      name: 'literal newline',
      input: '{"text": "line 1\nline 2"}',
      expected: '{"text": "line 1\\nline 2"}'
    },
    {
       name: 'bad escape x',
       input: '{"val": "\\x12"}',
       expected: '{"val": "x12"}'
    }
  ];

  for (const c of cases) {
    const repaired = repairJson(c.input);
    console.log(`Test: ${c.name}`);
    console.log(`Input:    ${JSON.stringify(c.input)}`);
    console.log(`Repaired: ${JSON.stringify(repaired)}`);
    try {
      JSON.parse(repaired);
      console.log('Result:   VALID JSON');
    } catch (err) {
      console.log('Result:   INVALID JSON', err.message);
    }
    console.log('---');
  }
}

testRepair();
