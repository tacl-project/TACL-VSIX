# TACL Language Support for Visual Studio Code

This extension provides syntax highlighting and language support for TACL (Type-Annotated Configuration Language) files in Visual Studio Code.

## Features

### Syntax Highlighting

The extension provides comprehensive syntax highlighting for all TACL language features:

- **Comments**: Line comments starting with `#`
- **Type Annotations**: Semicolon (`;`) and colon (`:`) separators
- **Type Definitions**: `@type` custom type declarations
- **Primitive Types**: `string`, `int`, `bool`, `float`, `null`, `object`
- **Collection Types**: `list[T]`, `dict[K, V]`
- **Advanced Types**: `optional[T]`, `union[T1, T2]`, `literal["a", "b"]`
- **String Literals**: Both single-line and multiline strings with YAML-style operators
- **References**: Variable references with `&` syntax (including nested and array references)
- **Numbers**: Integer and floating-point literals
- **Booleans**: `true` and `false` keywords
- **Data Structures**: Arrays `[...]` and objects `{...}`

### Language Configuration

- **Comment Support**: Automatic line commenting with `#`
- **Bracket Matching**: Automatic matching of `[]` and `{}`
- **Auto-Closing**: Automatic closing of brackets and quotes
- **Folding**: Code folding for type definitions
- **Indentation**: Smart indentation for nested structures

## Installation

1. Open Visual Studio Code
2. Press `Ctrl+P` / `Cmd+P` to open the Quick Open dialog
3. Type `ext install tacl` and press Enter
4. Click Install on the TACL Language Support extension

## Usage

The extension automatically activates for files with the `.tacl` extension.

### Example TACL File

```tacl
# Application configuration
app_name; string: "MyApp"
version; string: "1.0.0"
debug; bool: true

# Server configuration
server; dict[string, object]: {
  host: "localhost",
  port: 8080,
  ssl: false
}

# Custom type definition
@type Database:
  host; string
  port; int
  username; string
  password; optional[string]

# Using the custom type
db; Database: {
  host: "postgres.example.com",
  port: 5432,
  username: "admin",
  password: null
}

# References
primary_db; Database: &db
api_port; int: &server.port

# Multiline strings
welcome_message; string: |
  Welcome to MyApp!
  This is a multiline string
  with preserved formatting.

# Lists and literals
environments; list[literal["dev", "staging", "prod"]]: ["dev", "staging"]
allowed_ports; list[int]: [80, 443, 8080, 8443]
```

## Language Features

### Type System

TACL supports a rich type system with:
- Basic types: `string`, `int`, `bool`, `float`, `null`, `object`
- Optional types: `optional[T]` for nullable values
- Union types: `union[T1, T2, ...]` for multiple possible types
- Literal types: `literal["value1", "value2"]` for enum-like constraints
- Collection types: `list[T]` and `dict[K, V]`

### References

TACL supports variable references using the `&` syntax:
- Simple references: `&variable_name`
- Nested references: `&config.server.host`
- Array references: `&items[0]`
- Embedded references in strings: `"Server running on &host:&port"`

### Multiline Strings

TACL supports YAML-style multiline strings:
- `|` - Preserve line breaks
- `>` - Fold line breaks into spaces
- `|-` - Strip final newline
- `>-` - Folded strip final newline
- `|+` - Keep final newlines
- `>+` - Folded keep final newlines

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests on the [GitHub repository](https://github.com/tacl-lang/vscode-tacl).

## License

This extension is released under the MIT License.