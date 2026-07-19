import { XMLParser } from 'fast-xml-parser';

export interface AccessibleNode {
  type: string;
  name?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  bounds?: string;
}

export interface CompactObservation {
  nodes: AccessibleNode[];
  text: string;
  truncated: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
});

function asBoolean(value: unknown): boolean | undefined {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return undefined;
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact || undefined;
}

function visit(value: unknown, output: AccessibleNode[]): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const type = clean(record.type);
  const name = clean(record.name);
  const label = clean(record.label);
  const nodeValue = clean(record.value);
  const visible = asBoolean(record.visible);

  if (type && visible !== false && (name || label || nodeValue)) {
    const x = clean(record.x);
    const y = clean(record.y);
    const width = clean(record.width);
    const height = clean(record.height);
    output.push({
      type: type.replace(/^XCUIElementType/, ''),
      ...(name ? { name } : {}),
      ...(label && label !== name ? { label } : {}),
      ...(nodeValue && nodeValue !== name && nodeValue !== label ? { value: nodeValue } : {}),
      ...(asBoolean(record.enabled) !== undefined ? { enabled: asBoolean(record.enabled) } : {}),
      ...(x && y && width && height ? { bounds: `${x},${y},${width}x${height}` } : {}),
    });
  }

  for (const [key, child] of Object.entries(record)) {
    if (!['type', 'name', 'label', 'value', 'visible', 'enabled', 'x', 'y', 'width', 'height'].includes(key)) {
      visit(child, output);
    }
  }
}

export function compactAccessibilityTree(xml: string, maxCharacters = 12_000): CompactObservation {
  if (maxCharacters < 100) throw new Error('maxCharacters must be at least 100');
  const rawNodes: AccessibleNode[] = [];
  visit(parser.parse(xml), rawNodes);

  const seen = new Set<string>();
  const nodes = rawNodes.filter((node) => {
    const key = JSON.stringify(node);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const lines: string[] = [];
  let size = 0;
  let truncated = false;
  for (const node of nodes) {
    const line = JSON.stringify(node);
    if (size + line.length + 1 > maxCharacters) {
      truncated = true;
      break;
    }
    lines.push(line);
    size += line.length + 1;
  }

  return { nodes: nodes.slice(0, lines.length), text: lines.join('\n'), truncated };
}

export function observedText(nodes: AccessibleNode[]): string {
  return nodes.flatMap((node) => [node.name, node.label, node.value]).filter(Boolean).join('\n');
}

const tappableTypes = new Set(['Button', 'Cell', 'Link', 'SecureTextField', 'Switch', 'TextField']);

export function selectorForObservedText(text: string, nodes: AccessibleNode[]): string {
  const target = nodes.find((node) =>
    tappableTypes.has(node.type) && (node.name === text || node.label === text),
  );
  if (!target) return `~${text}`;

  if (target.type === 'Switch' && nodes.some((node) => node.type === 'Switch' && !node.name && !node.label)) {
    return `//XCUIElementTypeSwitch[@name=${xpathLiteral(text)}]/XCUIElementTypeSwitch`;
  }

  const escaped = text.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `-ios predicate string:type == "XCUIElementType${target.type}" AND (name == "${escaped}" OR label == "${escaped}")`;
}

function xpathLiteral(text: string): string {
  if (!text.includes('"')) return `"${text}"`;
  if (!text.includes("'")) return `'${text}'`;
  return `concat(${text.split('"').map((part) => `"${part}"`).join(", '\"', ")})`;
}
