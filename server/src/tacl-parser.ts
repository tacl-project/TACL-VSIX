import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range } from 'vscode-languageserver/node';

export type TACLValue = string | number | boolean | null | TACLValue[] | { [key: string]: TACLValue } | TACLReference;

export interface TACLReference {
  type: 'reference';
  path: string;
  range: Range;
  resolved?: TACLValue;
}

export interface TACLTypeDefinition {
  name: string;
  fields: Map<string, TACLFieldDefinition>;
  range: Range;
}

export interface TACLFieldDefinition {
  name: string;
  type: TACLType;
  value?: TACLValue;
  range: Range;
  typeRange?: Range;
  valueRange?: Range;
}

export interface TACLType {
  kind: 'primitive' | 'collection' | 'optional' | 'union' | 'literal' | 'custom';
  name: string;
  typeParams?: TACLType[];
  literalValues?: (string | number | boolean)[];
}

export interface TACLDocument {
  types: Map<string, TACLTypeDefinition>;
  fields: Map<string, TACLFieldDefinition>;
  references: TACLReference[];
  diagnostics: TACLDiagnostic[];
}

export interface TACLDiagnostic {
  range: Range;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export class TACLParser {
  private document: TextDocument;
  private lines: string[];
  private types: Map<string, TACLTypeDefinition>;
  private fields: Map<string, TACLFieldDefinition>;
  private references: TACLReference[];
  private diagnostics: TACLDiagnostic[];

  constructor(document: TextDocument) {
    this.document = document;
    this.lines = document.getText().split('\n');
    this.types = new Map();
    this.fields = new Map();
    this.references = [];
    this.diagnostics = [];
  }

  parse(): TACLDocument {
    let currentType: TACLTypeDefinition | null = null;
    let currentIndentLevel = 0;

    for (let lineNum = 0; lineNum < this.lines.length; lineNum++) {
      const line = this.lines[lineNum];
      const trimmedLine = line.trim();

      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      const indentLevel = this.getIndentLevel(line);

      // Check for type definition
      const typeMatch = trimmedLine.match(/^@type\s+(\w+)\s*:/);
      if (typeMatch) {
        currentType = {
          name: typeMatch[1],
          fields: new Map(),
          range: this.createRange(lineNum, 0, lineNum, line.length)
        };
        this.types.set(currentType.name, currentType);
        currentIndentLevel = indentLevel;
        continue;
      }

      // If we're inside a type definition
      if (currentType && indentLevel > currentIndentLevel) {
        const field = this.parseFieldDefinition(line, lineNum);
        if (field) {
          currentType.fields.set(field.name, field);
        }
        continue;
      } else if (currentType && indentLevel <= currentIndentLevel) {
        currentType = null;
      }

      // Parse top-level field
      const field = this.parseFieldDefinition(line, lineNum);
      if (field) {
        this.fields.set(field.name, field);
      }
    }

    // Resolve references
    this.resolveReferences();

    return {
      types: this.types,
      fields: this.fields,
      references: this.references,
      diagnostics: this.diagnostics
    };
  }

  private parseFieldDefinition(line: string, lineNum: number): TACLFieldDefinition | null {
    const trimmedLine = line.trim();
    
    // Match field with type and value: name; type: value
    const fullMatch = trimmedLine.match(/^(\w+)\s*;\s*([^:]+)\s*:\s*(.*)$/);
    if (fullMatch) {
      const [, name, typeStr, valueStr] = fullMatch;
      const type = this.parseType(typeStr.trim());
      const valueStartCol = line.indexOf(valueStr);
      const value = this.parseValue(valueStr.trim(), lineNum, valueStartCol);
      
      return {
        name,
        type,
        value,
        range: this.createRange(lineNum, 0, lineNum, line.length),
        typeRange: this.createRange(lineNum, line.indexOf(typeStr), lineNum, line.indexOf(typeStr) + typeStr.length),
        valueRange: this.createRange(lineNum, valueStartCol, lineNum, line.length)
      };
    }

    // Match field with type only: name; type
    const typeOnlyMatch = trimmedLine.match(/^(\w+)\s*;\s*(.+)$/);
    if (typeOnlyMatch) {
      const [, name, typeStr] = typeOnlyMatch;
      const type = this.parseType(typeStr.trim());
      
      return {
        name,
        type,
        range: this.createRange(lineNum, 0, lineNum, line.length),
        typeRange: this.createRange(lineNum, line.indexOf(typeStr), lineNum, line.indexOf(typeStr) + typeStr.length)
      };
    }

    // Match simple key-value: key: value
    const simpleMatch = trimmedLine.match(/^(\w+)\s*:\s*(.*)$/);
    if (simpleMatch) {
      const [, name, valueStr] = simpleMatch;
      const valueStartCol = line.indexOf(valueStr);
      const value = this.parseValue(valueStr.trim(), lineNum, valueStartCol);
      
      return {
        name,
        type: { kind: 'primitive', name: 'inferred' },
        value,
        range: this.createRange(lineNum, 0, lineNum, line.length),
        valueRange: this.createRange(lineNum, valueStartCol, lineNum, line.length)
      };
    }

    return null;
  }

  private parseType(typeStr: string): TACLType {
    // Check for primitive types
    if (['string', 'int', 'bool', 'float', 'null', 'object'].includes(typeStr)) {
      return { kind: 'primitive', name: typeStr };
    }

    // Check for optional type: optional[T]
    const optionalMatch = typeStr.match(/^optional\[(.+)\]$/);
    if (optionalMatch) {
      return {
        kind: 'optional',
        name: 'optional',
        typeParams: [this.parseType(optionalMatch[1].trim())]
      };
    }

    // Check for list type: list[T]
    const listMatch = typeStr.match(/^list\[(.+)\]$/);
    if (listMatch) {
      return {
        kind: 'collection',
        name: 'list',
        typeParams: [this.parseType(listMatch[1].trim())]
      };
    }

    // Check for dict type: dict[K, V]
    const dictMatch = typeStr.match(/^dict\[(.+),\s*(.+)\]$/);
    if (dictMatch) {
      return {
        kind: 'collection',
        name: 'dict',
        typeParams: [
          this.parseType(dictMatch[1].trim()),
          this.parseType(dictMatch[2].trim())
        ]
      };
    }

    // Check for union type: union[T1, T2, ...]
    const unionMatch = typeStr.match(/^union\[(.+)\]$/);
    if (unionMatch) {
      const types = unionMatch[1].split(',').map(t => this.parseType(t.trim()));
      return {
        kind: 'union',
        name: 'union',
        typeParams: types
      };
    }

    // Check for literal type: literal["a", "b", "c"]
    const literalMatch = typeStr.match(/^literal\[(.+)\]$/);
    if (literalMatch) {
      const values = literalMatch[1].split(',').map(v => {
        const trimmed = v.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
          return trimmed.slice(1, -1);
        }
        return trimmed;
      });
      return {
        kind: 'literal',
        name: 'literal',
        literalValues: values
      };
    }

    // Otherwise it's a custom type
    return { kind: 'custom', name: typeStr };
  }

  private parseValue(valueStr: string, lineNum: number, startCol: number): TACLValue {
    const trimmed = valueStr.trim();

    // Handle multiline strings
    if (trimmed.match(/^[|>][-+]?$/)) {
      return this.parseMultilineString(lineNum + 1, this.getIndentLevel(this.lines[lineNum]) + 2);
    }

    // Handle references
    if (trimmed.startsWith('&')) {
      const ref: TACLReference = {
        type: 'reference',
        path: trimmed.substring(1),
        range: this.createRange(lineNum, startCol, lineNum, startCol + trimmed.length)
      };
      this.references.push(ref);
      return ref;
    }

    // Handle strings
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }

    // Handle numbers
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed);
    }

    // Handle booleans
    if (trimmed === 'true' || trimmed === 'false') {
      return trimmed === 'true';
    }

    // Handle null
    if (trimmed === 'null') {
      return null;
    }

    // Handle arrays
    if (trimmed.startsWith('[')) {
      return this.parseArray(trimmed, lineNum, startCol);
    }

    // Handle objects
    if (trimmed.startsWith('{')) {
      return this.parseInlineObject(trimmed, lineNum, startCol);
    }

    // Check if it's the start of a nested object or list
    if (!trimmed || trimmed === '') {
      // Check if next line starts with a list item
      if (lineNum + 1 < this.lines.length) {
        const nextLine = this.lines[lineNum + 1];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed.startsWith('-')) {
          return this.parseYAMLList(lineNum + 1, this.getIndentLevel(this.lines[lineNum]) + 2);
        }
      }
      return this.parseNestedObject(lineNum + 1, this.getIndentLevel(this.lines[lineNum]) + 2);
    }

    // Default to string
    return trimmed;
  }

  private parseMultilineString(startLine: number, minIndent: number): string {
    const lines: string[] = [];
    
    for (let i = startLine; i < this.lines.length; i++) {
      const line = this.lines[i];
      const indent = this.getIndentLevel(line);
      
      // Stop if we hit a line with less indentation
      if (line.trim() && indent < minIndent) {
        break;
      }
      
      // Add the line, removing the minimum indentation
      lines.push(line.substring(minIndent));
    }
    
    return lines.join('\n').trimEnd();
  }

  private parseArray(arrayStr: string, lineNum: number, startCol: number): TACLValue[] {
    // Simple array parsing - could be enhanced for better reference handling
    const content = arrayStr.slice(1, -1).trim();
    if (!content) return [];
    
    const items = content.split(',').map(item => {
      const trimmed = item.trim();
      const itemStartCol = startCol + arrayStr.indexOf(item);
      return this.parseValue(trimmed, lineNum, itemStartCol);
    });
    
    return items;
  }

  private parseInlineObject(objStr: string, lineNum: number, startCol: number): { [key: string]: TACLValue } {
    // Simple inline object parsing
    const obj: { [key: string]: TACLValue } = {};
    // This is a simplified implementation - a full parser would handle nested objects better
    return obj;
  }

  private parseNestedObject(startLine: number, minIndent: number): { [key: string]: TACLValue } {
    const obj: { [key: string]: TACLValue } = {};
    
    for (let i = startLine; i < this.lines.length; i++) {
      const line = this.lines[i];
      const indent = this.getIndentLevel(line);
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      // Stop if we hit a line with less indentation
      if (indent < minIndent) {
        break;
      }
      
      // Only process direct children
      if (indent === minIndent) {
        const match = trimmed.match(/^(\w+)\s*:\s*(.*)$/);
        if (match) {
          const [, key, valueStr] = match;
          const valueStartCol = line.indexOf(valueStr);
          obj[key] = this.parseValue(valueStr, i, valueStartCol);
        }
      }
    }
    
    return obj;
  }

  private parseYAMLList(startLine: number, minIndent: number): TACLValue[] {
    const items: TACLValue[] = [];
    
    for (let i = startLine; i < this.lines.length; i++) {
      const line = this.lines[i];
      const indent = this.getIndentLevel(line);
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      // Stop if we hit a line with less indentation
      if (indent < minIndent) {
        break;
      }
      
      // Process list items at the correct indentation level
      if (trimmed.startsWith('-')) {
        const valueStr = trimmed.substring(1).trim();
        const valueStartCol = line.indexOf(valueStr);
        
        // Handle quoted strings in list items
        if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
          items.push(valueStr.slice(1, -1));
        } else if (/^-?\d+(\.\d+)?$/.test(valueStr)) {
          // Handle numbers
          items.push(valueStr.includes('.') ? parseFloat(valueStr) : parseInt(valueStr));
        } else if (valueStr === 'true' || valueStr === 'false') {
          // Handle booleans
          items.push(valueStr === 'true');
        } else if (valueStr === 'null') {
          // Handle null
          items.push(null);
        } else if (valueStr.startsWith('&')) {
          // Handle references
          const ref: TACLReference = {
            type: 'reference',
            path: valueStr.substring(1),
            range: this.createRange(i, valueStartCol, i, valueStartCol + valueStr.length)
          };
          this.references.push(ref);
          items.push(ref);
        } else {
          // Default to string (unquoted)
          items.push(valueStr);
        }
      }
    }
    
    return items;
  }

  private resolveReferences(): void {
    for (const ref of this.references) {
      const resolved = this.resolveReference(ref.path);
      if (resolved !== undefined) {
        ref.resolved = resolved;
      } else {
        this.diagnostics.push({
          range: ref.range,
          message: `Cannot resolve reference: &${ref.path}`,
          severity: 'error'
        });
      }
    }
  }

  private resolveReference(path: string): TACLValue | undefined {
    const parts = path.split('.');
    let current: any = null;
    
    // Start with top-level field
    const firstPart = parts[0];
    const field = this.fields.get(firstPart);
    if (!field || field.value === undefined) {
      return undefined;
    }
    
    current = field.value;
    
    // Navigate through the path
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      
      // Handle array index access
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, propName, indexStr] = arrayMatch;
        const index = parseInt(indexStr);
        
        if (current && typeof current === 'object' && propName in current) {
          current = current[propName];
          if (Array.isArray(current) && index < current.length) {
            current = current[index];
          } else {
            return undefined;
          }
        } else {
          return undefined;
        }
      } else {
        // Regular property access
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          return undefined;
        }
      }
    }
    
    return current;
  }

  private getIndentLevel(line: string): number {
    let indent = 0;
    for (const char of line) {
      if (char === ' ') indent++;
      else if (char === '\t') indent += 4; // Count tab as 4 spaces
      else break;
    }
    return indent;
  }

  private createRange(startLine: number, startChar: number, endLine: number, endChar: number): Range {
    return {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar }
    };
  }

  findReferenceAt(position: Position): TACLReference | undefined {
    return this.references.find(ref => 
      this.positionInRange(position, ref.range)
    );
  }

  findFieldAt(position: Position): TACLFieldDefinition | undefined {
    // Check top-level fields
    for (const field of this.fields.values()) {
      if (this.positionInRange(position, field.range)) {
        return field;
      }
    }
    
    // Check type fields
    for (const type of this.types.values()) {
      for (const field of type.fields.values()) {
        if (this.positionInRange(position, field.range)) {
          return field;
        }
      }
    }
    
    return undefined;
  }

  private positionInRange(position: Position, range: Range): boolean {
    if (position.line < range.start.line || position.line > range.end.line) {
      return false;
    }
    if (position.line === range.start.line && position.character < range.start.character) {
      return false;
    }
    if (position.line === range.end.line && position.character > range.end.character) {
      return false;
    }
    return true;
  }
}