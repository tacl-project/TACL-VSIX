import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  DocumentSymbol,
  SymbolKind,
  Hover,
  MarkupKind,
  Definition,
  Location,
  RenameParams,
  WorkspaceEdit,
  TextEdit,
  Range,
  Diagnostic,
  DiagnosticSeverity
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { TACLParser, TACLDocument, TACLValue, TACLReference, TACLFieldDefinition, TACLTypeDefinition } from './tacl-parser';

// Create a connection for the server, using Node's IPC as a transport.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Cache parsed documents
const parsedDocuments: Map<string, TACLDocument> = new Map();

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['&', '.', '[']
      },
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      renameProvider: true
    }
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }

  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
  validateTACLDocument(change.document);
});

async function validateTACLDocument(textDocument: TextDocument): Promise<void> {
  const parser = new TACLParser(textDocument);
  const parsed = parser.parse();
  
  // Store the parsed document
  parsedDocuments.set(textDocument.uri, parsed);
  
  // Convert TACL diagnostics to LSP diagnostics
  const diagnostics: Diagnostic[] = parsed.diagnostics.map(diag => ({
    severity: diag.severity === 'error' ? DiagnosticSeverity.Error :
              diag.severity === 'warning' ? DiagnosticSeverity.Warning :
              DiagnosticSeverity.Information,
    range: diag.range,
    message: diag.message,
    source: 'tacl'
  }));

  // Send the computed diagnostics to VS Code.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// Hover provider
connection.onHover(({ textDocument, position }): Hover | null => {
  const parsed = parsedDocuments.get(textDocument.uri);
  if (!parsed) return null;

  const parser = new TACLParser(documents.get(textDocument.uri)!);
  
  // Check if we're hovering over a reference
  const reference = parser.findReferenceAt(position);
  if (reference && reference.resolved !== undefined) {
    const content = formatHoverContent(reference);
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: content
      },
      range: reference.range
    };
  }

  // Check if we're hovering over a field
  const field = parser.findFieldAt(position);
  if (field) {
    const content = formatFieldHover(field);
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: content
      },
      range: field.range
    };
  }

  return null;
});

function formatHoverContent(reference: TACLReference): string {
  const lines: string[] = [];
  
  lines.push(`**Reference:** \`&${reference.path}\``);
  lines.push('');
  lines.push('**Resolved Value:**');
  lines.push('```tacl');
  lines.push(formatValue(reference.resolved!));
  lines.push('```');
  
  return lines.join('\n');
}

function formatFieldHover(field: TACLFieldDefinition): string {
  const lines: string[] = [];
  
  lines.push(`**Field:** \`${field.name}\``);
  lines.push('');
  lines.push(`**Type:** \`${formatType(field.type)}\``);
  
  if (field.value !== undefined) {
    lines.push('');
    lines.push('**Value:**');
    lines.push('```tacl');
    lines.push(formatValue(field.value));
    lines.push('```');
  }
  
  return lines.join('\n');
}

function formatType(type: any): string {
  if (type.kind === 'primitive') {
    return type.name;
  } else if (type.kind === 'optional') {
    return `optional[${formatType(type.typeParams[0])}]`;
  } else if (type.kind === 'collection') {
    if (type.name === 'list') {
      return `list[${formatType(type.typeParams[0])}]`;
    } else if (type.name === 'dict') {
      return `dict[${formatType(type.typeParams[0])}, ${formatType(type.typeParams[1])}]`;
    }
  } else if (type.kind === 'union') {
    return `union[${type.typeParams.map(formatType).join(', ')}]`;
  } else if (type.kind === 'literal') {
    return `literal[${type.literalValues.map((v: any) => JSON.stringify(v)).join(', ')}]`;
  } else if (type.kind === 'custom') {
    return type.name;
  }
  return 'unknown';
}

function formatValue(value: TACLValue, indent: number = 0): string {
  const spaces = ' '.repeat(indent);
  
  if (value === null) {
    return 'null';
  } else if (typeof value === 'string') {
    return JSON.stringify(value);
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  } else if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.length === 1 && typeof value[0] !== 'object') {
      return `[${formatValue(value[0])}]`;
    }
    const items = value.map(v => `${spaces}  - ${formatValue(v, indent + 4)}`);
    return `[\n${items.join('\n')}\n${spaces}]`;
  } else if (typeof value === 'object' && value !== null) {
    if ('type' in value && value.type === 'reference') {
      return `&${(value as TACLReference).path}`;
    }
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, v]) => {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        return `${spaces}${k}:\n${spaces}  ${formatValue(v, indent + 2).trim()}`;
      }
      return `${spaces}${k}: ${formatValue(v, indent + 2)}`;
    });
    return items.join('\n');
  }
  return String(value);
}

// Go to Definition provider
connection.onDefinition(({ textDocument, position }): Definition | null => {
  const parsed = parsedDocuments.get(textDocument.uri);
  if (!parsed) return null;

  const parser = new TACLParser(documents.get(textDocument.uri)!);
  
  // Check if we're on a reference
  const reference = parser.findReferenceAt(position);
  if (reference) {
    // Find the definition of the referenced field
    const path = reference.path.split('.')[0];
    const field = parsed.fields.get(path);
    if (field) {
      return Location.create(textDocument.uri, field.range);
    }
  }

  // Check if we're on a custom type
  const field = parser.findFieldAt(position);
  if (field && field.type.kind === 'custom') {
    const typeDef = parsed.types.get(field.type.name);
    if (typeDef) {
      return Location.create(textDocument.uri, typeDef.range);
    }
  }

  return null;
});

// Document Symbols provider
connection.onDocumentSymbol(({ textDocument }): DocumentSymbol[] => {
  const parsed = parsedDocuments.get(textDocument.uri);
  if (!parsed) return [];

  const symbols: DocumentSymbol[] = [];

  // Add type definitions
  for (const [name, typeDef] of parsed.types) {
    const typeSymbol: DocumentSymbol = {
      name: `@type ${name}`,
      kind: SymbolKind.Class,
      range: typeDef.range,
      selectionRange: typeDef.range,
      children: []
    };

    // Add type fields
    for (const [fieldName, field] of typeDef.fields) {
      typeSymbol.children!.push({
        name: `${fieldName}; ${formatType(field.type)}`,
        kind: SymbolKind.Property,
        range: field.range,
        selectionRange: field.range
      });
    }

    symbols.push(typeSymbol);
  }

  // Add top-level fields
  for (const [name, field] of parsed.fields) {
    symbols.push({
      name: `${name}; ${formatType(field.type)}`,
      kind: SymbolKind.Variable,
      range: field.range,
      selectionRange: field.range,
      detail: field.value !== undefined ? 'has value' : 'no value'
    });
  }

  return symbols;
});

// Completion provider
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const parsed = parsedDocuments.get(params.textDocument.uri);
  if (!parsed) return [];

  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: params.position
  });

  const completions: CompletionItem[] = [];

  // If we're typing a reference
  if (line.endsWith('&') || line.match(/&[\w.]*$/)) {
    // Add all available fields as completion items
    for (const [name, field] of parsed.fields) {
      completions.push({
        label: name,
        kind: CompletionItemKind.Reference,
        detail: formatType(field.type),
        documentation: field.value !== undefined ? `Value: ${formatValue(field.value)}` : undefined
      });
    }
  }

  // If we're typing after a dot in a reference
  const refMatch = line.match(/&([\w.]+)\.$/);
  if (refMatch) {
    const path = refMatch[1];
    const parser = new TACLParser(document);
    const parsed = parser.parse();
    
    // Try to resolve the partial path and get available properties
    const resolved = resolvePartialPath(parsed, path);
    if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
      for (const key of Object.keys(resolved)) {
        completions.push({
          label: key,
          kind: CompletionItemKind.Property,
          detail: typeof resolved[key]
        });
      }
    }
  }

  // Add type completions when typing after semicolon
  if (line.match(/;\s*$/)) {
    // Add primitive types
    ['string', 'int', 'bool', 'float', 'null', 'object'].forEach(type => {
      completions.push({
        label: type,
        kind: CompletionItemKind.Keyword,
        detail: 'primitive type'
      });
    });

    // Add collection types
    ['list', 'dict', 'optional', 'union', 'literal'].forEach(type => {
      completions.push({
        label: type,
        kind: CompletionItemKind.Keyword,
        detail: 'collection type',
        insertText: `${type}[$1]`
      });
    });

    // Add custom types
    for (const [name] of parsed.types) {
      completions.push({
        label: name,
        kind: CompletionItemKind.Class,
        detail: 'custom type'
      });
    }
  }

  return completions;
});

function resolvePartialPath(parsed: TACLDocument, path: string): any {
  const parts = path.split('.');
  let current: any = null;
  
  const firstField = parsed.fields.get(parts[0]);
  if (!firstField || firstField.value === undefined) {
    return null;
  }
  
  current = firstField.value;
  
  for (let i = 1; i < parts.length; i++) {
    if (current && typeof current === 'object' && parts[i] in current) {
      current = current[parts[i]];
    } else {
      return null;
    }
  }
  
  return current;
}

// Rename provider
connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
  const parsed = parsedDocuments.get(params.textDocument.uri);
  if (!parsed) return null;

  const parser = new TACLParser(documents.get(params.textDocument.uri)!);
  const field = parser.findFieldAt(params.position);
  
  if (!field) return null;

  const edits: TextEdit[] = [];
  
  // Rename the field definition
  edits.push({
    range: {
      start: field.range.start,
      end: { line: field.range.start.line, character: field.range.start.character + field.name.length }
    },
    newText: params.newName
  });

  // Find and rename all references to this field
  for (const ref of parsed.references) {
    if (ref.path.startsWith(field.name)) {
      const newPath = ref.path.replace(field.name, params.newName);
      edits.push({
        range: {
          start: { line: ref.range.start.line, character: ref.range.start.character + 1 }, // Skip the &
          end: ref.range.end
        },
        newText: newPath
      });
    }
  }

  return {
    changes: {
      [params.textDocument.uri]: edits
    }
  };
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();