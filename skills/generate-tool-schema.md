---
name: generate-tool-schema
description: >
  Generate JSON schema definitions for LLM function/tool calls following
  OpenAI function-calling format. Output includes name, description, strict
  flag, and typed parameters with descriptions.
  Use when: designing tool schemas for LLM agents; converting a function
  signature or natural-language description into a JSON tool definition;
  adding a new tool to an agent's tool registry.
  Skip when: implementing the function code itself (not its schema); working
  with non-function-calling APIs; generating regular JSON data structures
  that are not tool definitions.
version: "1.0"
---

# Generate Tool Schema

Generate JSON schema for one or more LLM function/tool calls from any description.

## SOP

1. **Identify the function's purpose** — what action does it perform? what are the inputs?
2. **Name the function** — use `snake_case`, verb-first (`send_email`, `calculate_area`)
3. **Write the description** — include when to use and when not to use if applicable
4. **List parameters** — identify required vs optional; assign correct JSON Schema types
5. **Output the JSON** — one `\`\`\`json` block per function; separated by 2 blank lines if multiple

## Requirements

The JSON must include:

- `name` — string, `snake_case`, verb-first
- `description` — string describing purpose; add `when to use` / `when not to use` if the function has non-obvious scope
- `strict` — boolean; use `true` unless the function explicitly needs flexible/extra properties
- `parameters` — object with:
  - `type`: must be `"object"`
  - `required`: array of required parameter names
  - `properties`: each key is a parameter name with `type` and `description`
  - `additionalProperties`: `false` when `strict: true`

Parameter types follow JSON Schema: `"string"`, `"number"`, `"integer"`, `"boolean"`, `"array"`, `"object"`.

Follow Python PEP 8 naming style for parameter names.

## Output Format

```json
{
  "name": "function_name",
  "description": "What this function does.",
  "strict": true,
  "parameters": {
    "type": "object",
    "required": ["param1", "param2"],
    "properties": {
      "param1": {
        "type": "string",
        "description": "Description of param1."
      },
      "param2": {
        "type": "number",
        "description": "Description of param2."
      }
    },
    "additionalProperties": false
  }
}
```

## Examples

### Example 1 — Simple calculation

**Input:** Create a function to calculate the area of a rectangle.

**Output:**

```json
{
  "name": "calculate_rectangle_area",
  "description": "Calculates the area of a rectangle given its width and height.",
  "strict": true,
  "parameters": {
    "type": "object",
    "required": ["width", "height"],
    "properties": {
      "width": {
        "type": "number",
        "description": "The width of the rectangle."
      },
      "height": {
        "type": "number",
        "description": "The height of the rectangle."
      }
    },
    "additionalProperties": false
  }
}
```

### Example 2 — Action with optional parameters

**Input:** Create a function to send an email with optional CC.

**Output:**

```json
{
  "name": "send_email",
  "description": "Sends an email to the specified recipient. Use when delivering a message to one or more email addresses. Not for bulk mailing or internal system notifications.",
  "strict": true,
  "parameters": {
    "type": "object",
    "required": ["recipient", "subject", "body"],
    "properties": {
      "recipient": {
        "type": "string",
        "description": "The email address of the recipient."
      },
      "subject": {
        "type": "string",
        "description": "The subject line of the email."
      },
      "body": {
        "type": "string",
        "description": "The body content of the email."
      },
      "cc": {
        "type": "string",
        "description": "Optional comma-separated CC email addresses."
      }
    },
    "additionalProperties": false
  }
}
```

### Example 3 — Multiple functions at once

**Input:** Create functions to list and delete files.

**Output:**

```json
{
  "name": "list_files",
  "description": "Lists files in a directory. Use when you need to enumerate directory contents. Not for recursive search — use search_files for that.",
  "strict": true,
  "parameters": {
    "type": "object",
    "required": ["path"],
    "properties": {
      "path": {
        "type": "string",
        "description": "The directory path to list."
      },
      "include_hidden": {
        "type": "boolean",
        "description": "Whether to include hidden files (starting with '.'). Defaults to false."
      }
    },
    "additionalProperties": false
  }
}


{
  "name": "delete_file",
  "description": "Permanently deletes a file. Use when a file needs to be removed. Not for directories — use delete_directory for that.",
  "strict": true,
  "parameters": {
    "type": "object",
    "required": ["path"],
    "properties": {
      "path": {
        "type": "string",
        "description": "The path of the file to delete."
      }
    },
    "additionalProperties": false
  }
}
```

## Notes

- Output the JSON directly inside a `\`\`\`json` block — no prose around it unless the user asks for explanation
- Each tool JSON gets its own standalone `\`\`\`json` block
- Multiple functions: separate each block with 2 blank lines
- Optional parameters: include in `properties` but omit from `required`
- When `strict: true`, set `additionalProperties: false`
- Array parameters: add `"items": { "type": "..." }` inside the property
