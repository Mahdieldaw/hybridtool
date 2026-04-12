/**
 * Minimal safe expression evaluator — no eval().
 * Supports arithmetic, comparison, logic, ternary, and column references.
 */

import type { EvidenceRow } from '../../hooks/useEvidenceRows';

// ============================================================================
// TOKENIZER
// ============================================================================

type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'IDENT'
  | 'BOOL'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'PERCENT'
  | 'GT'
  | 'LT'
  | 'GTE'
  | 'LTE'
  | 'EQ'
  | 'NEQ'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'QUESTION'
  | 'COLON'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string | number | boolean;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(input[i]) || (input[i] === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let num = '';
      let hasDot = false;
      while (i < input.length && /[0-9.]/.test(input[i])) {
        if (input[i] === '.') {
          if (hasDot) break; // Stop at second decimal
          hasDot = true;
        }
        num += input[i++];
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(num) });
      continue;
    }

    // Strings
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i++];
      let str = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1];
          if (next === quote || next === '\\') {
            str += next;
            i += 2;
          } else if (next === 'n') {
            str += '\n';
            i += 2;
          } else if (next === 't') {
            str += '\t';
            i += 2;
          } else {
            str += next;
            i += 2;
          }
        } else {
          str += input[i++];
        }
      }
      if (i >= input.length) throw new Error(`Unclosed string literal starting with ${quote}`);
      i++; // closing quote
      tokens.push({ type: 'STRING', value: str });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(input[i])) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_$]/.test(input[i])) ident += input[i++];
      if (ident === 'true') tokens.push({ type: 'BOOL', value: true });
      else if (ident === 'false') tokens.push({ type: 'BOOL', value: false });
      else if (ident === 'null')
        tokens.push({ type: 'NUMBER', value: NaN }); // treat null as NaN
      else tokens.push({ type: 'IDENT', value: ident });
      continue;
    }

    // Two-char operators
    const two = input.slice(i, i + 3);
    if (two === '===') {
      tokens.push({ type: 'EQ', value: '===' });
      i += 3;
      continue;
    }
    if (two === '!==') {
      tokens.push({ type: 'NEQ', value: '!==' });
      i += 3;
      continue;
    }
    const tw = input.slice(i, i + 2);
    if (tw === '&&') {
      tokens.push({ type: 'AND', value: '&&' });
      i += 2;
      continue;
    }
    if (tw === '||') {
      tokens.push({ type: 'OR', value: '||' });
      i += 2;
      continue;
    }
    if (tw === '>=') {
      tokens.push({ type: 'GTE', value: '>=' });
      i += 2;
      continue;
    }
    if (tw === '<=') {
      tokens.push({ type: 'LTE', value: '<=' });
      i += 2;
      continue;
    }
    if (tw === '==') {
      tokens.push({ type: 'EQ', value: '==' });
      i += 2;
      continue;
    }
    if (tw === '!=') {
      tokens.push({ type: 'NEQ', value: '!=' });
      i += 2;
      continue;
    }

    // Single-char operators
    switch (input[i]) {
      case '+':
        tokens.push({ type: 'PLUS', value: '+' });
        i++;
        break;
      case '-':
        tokens.push({ type: 'MINUS', value: '-' });
        i++;
        break;
      case '*':
        tokens.push({ type: 'STAR', value: '*' });
        i++;
        break;
      case '/':
        tokens.push({ type: 'SLASH', value: '/' });
        i++;
        break;
      case '%':
        tokens.push({ type: 'PERCENT', value: '%' });
        i++;
        break;
      case '>':
        tokens.push({ type: 'GT', value: '>' });
        i++;
        break;
      case '<':
        tokens.push({ type: 'LT', value: '<' });
        i++;
        break;
      case '!':
        tokens.push({ type: 'NOT', value: '!' });
        i++;
        break;
      case '?':
        tokens.push({ type: 'QUESTION', value: '?' });
        i++;
        break;
      case ':':
        tokens.push({ type: 'COLON', value: ':' });
        i++;
        break;
      case '(':
        tokens.push({ type: 'LPAREN', value: '(' });
        i++;
        break;
      case ')':
        tokens.push({ type: 'RPAREN', value: ')' });
        i++;
        break;
      case ',':
        tokens.push({ type: 'COMMA', value: ',' });
        i++;
        break;
      default:
        i++; // skip unknown characters
    }
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

// ============================================================================
// PARSER + EVALUATOR
// ============================================================================

type Env = Record<string, number | string | boolean | null>;

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private consume(): Token {
    return this.tokens[this.pos++];
  }
  private expect(type: TokenType): Token {
    const t = this.consume();
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type}`);
    return t;
  }

  parse(env: Env): number | string | boolean | null {
    const result = this.parseTernary(env);
    if (this.peek().type !== 'EOF') throw new Error('Unexpected tokens after expression');
    return result;
  }

  private parseTernary(env: Env): number | string | boolean | null {
    const cond = this.parseOr(env);
    if (this.peek().type === 'QUESTION') {
      this.consume();
      const a = this.parseTernary(env);
      this.expect('COLON');
      const b = this.parseTernary(env);
      return cond ? a : b;
    }
    return cond;
  }

  private parseOr(env: Env): number | string | boolean | null {
    let left = this.parseAnd(env);
    while (this.peek().type === 'OR') {
      this.consume();
      const right = this.parseAnd(env);
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(env: Env): number | string | boolean | null {
    let left = this.parseEquality(env);
    while (this.peek().type === 'AND') {
      this.consume();
      const right = this.parseEquality(env);
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseEquality(env: Env): number | string | boolean | null {
    let left = this.parseComparison(env);
    while (this.peek().type === 'EQ' || this.peek().type === 'NEQ') {
      const op = this.consume().type;
      const right = this.parseComparison(env);
      left = op === 'EQ' ? left === right : left !== right;
    }
    return left;
  }

  private parseComparison(env: Env): number | string | boolean | null {
    let left = this.parseAddSub(env);
    const t = this.peek().type;
    if (t === 'GT' || t === 'LT' || t === 'GTE' || t === 'LTE') {
      this.consume();
      const right = this.parseAddSub(env);
      if (left == null || right == null) return null;
      const l = Number(left),
        r = Number(right);
      if (t === 'GT') return l > r;
      if (t === 'LT') return l < r;
      if (t === 'GTE') return l >= r;
      return l <= r;
    }
    return left;
  }

  private parseAddSub(env: Env): number | string | boolean | null {
    let left = this.parseMulDiv(env);
    while (this.peek().type === 'PLUS' || this.peek().type === 'MINUS') {
      const op = this.consume().type;
      const right = this.parseMulDiv(env);
      if (left == null || right == null) return null;
      if (op === 'PLUS') {
        if (typeof left === 'string' || typeof right === 'string')
          return String(left) + String(right);
        return Number(left) + Number(right);
      }
      return Number(left) - Number(right);
    }
    return left;
  }

  private parseMulDiv(env: Env): number | string | boolean | null {
    let left = this.parseUnary(env);
    while (
      this.peek().type === 'STAR' ||
      this.peek().type === 'SLASH' ||
      this.peek().type === 'PERCENT'
    ) {
      const op = this.consume().type;
      const right = this.parseUnary(env);
      if (left == null || right == null) return null;
      const l = Number(left),
        r = Number(right);
      if (op === 'STAR') return l * r;
      if (op === 'SLASH') return r === 0 ? null : l / r;
      return l % r;
    }
    return left;
  }

  private parseUnary(env: Env): number | string | boolean | null {
    if (this.peek().type === 'MINUS') {
      this.consume();
      const v = this.parseUnary(env);
      if (v == null) return null;
      return -Number(v);
    }
    if (this.peek().type === 'NOT') {
      this.consume();
      return !this.parseUnary(env);
    }
    return this.parsePrimary(env);
  }

  private parsePrimary(env: Env): number | string | boolean | null {
    const t = this.peek();

    if (t.type === 'NUMBER') {
      this.consume();
      return isNaN(t.value as number) ? null : (t.value as number);
    }

    if (t.type === 'STRING') {
      this.consume();
      return t.value as string;
    }

    if (t.type === 'BOOL') {
      this.consume();
      return t.value as boolean;
    }

    if (t.type === 'IDENT') {
      this.consume();
      const name = t.value as string;

      // Built-in functions
      if (this.peek().type === 'LPAREN') {
        this.consume(); // (
        const args: (number | string | boolean | null)[] = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseTernary(env));
          while (this.peek().type === 'COMMA') {
            this.consume();
            args.push(this.parseTernary(env));
          }
        }
        this.expect('RPAREN');
        return this.callFunction(name, args);
      }

      // Column reference
      if (name in env) return env[name];
      return null;
    }

    if (t.type === 'LPAREN') {
      this.consume();
      const v = this.parseTernary(env);
      this.expect('RPAREN');
      return v;
    }

    throw new Error(`Unexpected token: ${t.type}`);
  }

  private callFunction(
    name: string,
    args: (number | string | boolean | null)[]
  ): number | string | boolean | null {
    const nums = args.map((a) => (a == null ? null : Number(a)));
    switch (name) {
      case 'abs': {
        const v = nums[0];
        return v == null ? null : Math.abs(v);
      }
      case 'max': {
        const valid = nums.filter((v): v is number => v != null);
        return valid.length === 0 ? null : Math.max(...valid);
      }
      case 'min': {
        const valid = nums.filter((v): v is number => v != null);
        return valid.length === 0 ? null : Math.min(...valid);
      }
      case 'round': {
        const v = nums[0];
        return v == null ? null : Math.round(v);
      }
      default:
        throw new Error(`Unknown function: ${name}`);
    }
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export interface CompiledExpression {
  expression: string;
  evaluate: (row: EvidenceRow) => number | string | boolean | null;
}

/**
 * Compile an expression string into a reusable evaluator.
 * Returns null if the expression fails to parse.
 */
export function compileExpression(
  expression: string,
  columnIds: string[]
): CompiledExpression | null {
  try {
    // Validate by parsing with a dummy env
    const dummyEnv: Env = Object.fromEntries(columnIds.map((id) => [id, null]));
    const tokens = tokenize(expression);
    const parser = new Parser(tokens);
    parser.parse(dummyEnv);
  } catch {
    return null;
  }

  return {
    expression,
    evaluate(row: EvidenceRow): number | string | boolean | null {
      try {
        const env: Env = {};
        for (const id of columnIds) {
          const val = (row as any)[id];
          env[id] = val === undefined ? null : val;
        }
        const tokens = tokenize(expression);
        const parser = new Parser(tokens);
        return parser.parse(env);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Validate an expression without compiling.
 * Returns an error string or null if valid.
 */
export function validateExpression(expression: string, columnIds: string[]): string | null {
  try {
    const dummyEnv: Env = Object.fromEntries(columnIds.map((id) => [id, 0]));
    const tokens = tokenize(expression);
    const parser = new Parser(tokens);
    parser.parse(dummyEnv);
    return null;
  } catch (e: any) {
    return e?.message ?? 'Invalid expression';
  }
}
