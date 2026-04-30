// standalone test for repairJson logic
function repairJson(text) {
  const input = String(text ?? '');
  if (!input) return '';

  const fixInvalidStringEscapes = (src) => {
    let out = '';
    let quote = null;
    let esc = false;

    const isHex = (c) => /[0-9A-Fa-f]/.test(c);
    const isAllowedEscape = (c, idx, full) => {
      if (c === 'u') {
        for (let j = 1; j <= 4; j++) {
          const nextChar = full[idx + j];
          if (!nextChar || !isHex(nextChar)) return false;
        }
        return true;
      }
      return (
        c === '"' ||
        c === '\\' ||
        c === '/' ||
        c === 'b' ||
        c === 'f' ||
        c === 'n' ||
        c === 'r' ||
        c === 't'
      );
    };

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      const next = i + 1 < src.length ? src[i + 1] : '';

      if (quote) {
        if (esc) {
          esc = false;
          out += ch;
          continue;
        }
        if (ch === '\\') {
          if (next && !isAllowedEscape(next, i, src)) {
            continue;
          }
          esc = true;
          out += ch;
          continue;
        }
        if (ch === '\n' || ch === '\r') {
          out += '\\n';
          if (ch === '\r' && next === '\n') i++;
          continue;
        }
        out += ch;
        if (ch === quote) {
          quote = null;
        }
        continue;
      }

      out += ch;
      if (ch === '"' || ch === "'") {
        quote = ch;
        esc = false;
      }
    }
    return out;
  };

  return fixInvalidStringEscapes(input);
}

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
