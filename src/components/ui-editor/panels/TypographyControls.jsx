// @ts-nocheck
import React from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function normalizeColor(value, fallback = '#ffffff') {
  if (!value) return fallback;
  if (value.startsWith('#') && (value.length === 7 || value.length === 4)) return value;

  const rgbMatch = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    const toHex = (v) => Number(v).toString(16).padStart(2, '0');
    return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
  }

  return fallback;
}

const FONT_FAMILIES = ['Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'monospace'];
const DEFAULT_LINE_HEIGHT = 1.2;
const DEFAULT_LETTER_SPACING = 0;

function parseFontSizeValue(value) {
  const source = String(value || '').trim();
  const match = source.match(/^(-?\d*\.?\d+)(px|rem)?$/i);
  if (!match) return { number: 16, unit: 'px' };
  const number = parseFloat(match[1]);
  const unit = (match[2] || 'px').toLowerCase();
  return { number: Number.isNaN(number) ? 16 : number, unit };
}

function Row({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-zinc-400">{label}</Label>
      {children}
    </div>
  );
}

export default function TypographyControls({ selectedNode, applyStyle }) {
  const styles = selectedNode?.styles || {};
  const parsedFontSize = parseFontSizeValue(styles.fontSize || '16px');
  const fontSizePx = parsedFontSize.number;
  const fontUnit = parsedFontSize.unit === 'rem' ? 'rem' : 'px';
  const lineHeight = parseFloat(String(styles.lineHeight || DEFAULT_LINE_HEIGHT)) || DEFAULT_LINE_HEIGHT;
  const letterSpacing = parseFloat(String(styles.letterSpacing || DEFAULT_LETTER_SPACING)) || DEFAULT_LETTER_SPACING;
  const colorHex = normalizeColor(styles.color, '#ffffff');

  const isUnderline = String(styles.textDecoration || '').includes('underline');
  const isLineThrough = String(styles.textDecoration || '').includes('line-through');
  const isItalic = String(styles.fontStyle || '').includes('italic');

  function updateTextDecoration(nextUnderline, nextLineThrough) {
    const parts = [];
    if (nextUnderline) parts.push('underline');
    if (nextLineThrough) parts.push('line-through');
    applyStyle('textDecoration', parts.length ? parts.join(' ') : 'none');
  }

  return (
    <div className="space-y-4">
      <Row label="Font Family">
        <Select value={styles.fontFamily || 'Inter'} onValueChange={(value) => applyStyle('fontFamily', value)}>
          <SelectTrigger className="bg-zinc-900 border-zinc-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((font) => (
              <SelectItem key={font} value={font}>{font}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <div className="grid grid-cols-2 gap-2">
        <Row label="Font Size">
          <Input
            type="number"
            value={Number.isNaN(fontSizePx) ? '' : fontSizePx}
            onChange={(event) => applyStyle('fontSize', `${event.target.value || 0}px`)}
            className="bg-zinc-900 border-zinc-700"
          />
        </Row>
        <Row label="Unit">
          <Select value={fontUnit} onValueChange={(unit) => applyStyle('fontSize', `${fontSizePx}${unit}`)}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="px">px</SelectItem>
              <SelectItem value="rem">rem</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </div>

      <Row label="Font Weight">
        <Select value={String(styles.fontWeight || '400')} onValueChange={(value) => applyStyle('fontWeight', value)}>
          <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'].map((weight) => (
              <SelectItem key={weight} value={weight}>{weight}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <div className="grid grid-cols-2 gap-2">
        <Row label="Line Height">
          <Input
            type="number"
            step="0.1"
            value={Number.isNaN(lineHeight) ? '' : lineHeight}
            onChange={(event) => applyStyle('lineHeight', event.target.value || String(DEFAULT_LINE_HEIGHT))}
            className="bg-zinc-900 border-zinc-700"
          />
        </Row>
        <Row label="Letter Spacing (em)">
          <Input
            type="number"
            step="0.01"
            value={Number.isNaN(letterSpacing) ? '' : letterSpacing}
            onChange={(event) => applyStyle('letterSpacing', `${event.target.value || 0}em`)}
            className="bg-zinc-900 border-zinc-700"
          />
        </Row>
      </div>

      <Row label="Text Align">
        <ToggleGroup
          type="single"
          value={styles.textAlign || 'left'}
          onValueChange={(value) => value && applyStyle('textAlign', value)}
          className="justify-start"
        >
          <ToggleGroupItem value="left" aria-label="Align left"><AlignLeft className="w-4 h-4" /></ToggleGroupItem>
          <ToggleGroupItem value="center" aria-label="Align center"><AlignCenter className="w-4 h-4" /></ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Align right"><AlignRight className="w-4 h-4" /></ToggleGroupItem>
          <ToggleGroupItem value="justify" aria-label="Justify"><AlignJustify className="w-4 h-4" /></ToggleGroupItem>
        </ToggleGroup>
      </Row>

      <Row label="Text Color">
        <div className="flex gap-2">
          <Input
            type="color"
            value={colorHex}
            onChange={(event) => applyStyle('color', event.target.value)}
            className="w-12 p-1 bg-zinc-900 border-zinc-700"
          />
          <Input
            type="text"
            value={colorHex}
            onChange={(event) => applyStyle('color', event.target.value)}
            className="bg-zinc-900 border-zinc-700"
          />
        </div>
      </Row>

      <Row label="Text Decoration">
        <div className="space-y-2 text-sm text-zinc-300">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={isUnderline}
              onCheckedChange={(checked) => updateTextDecoration(Boolean(checked), isLineThrough)}
            />
            Underline
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={isLineThrough}
              onCheckedChange={(checked) => updateTextDecoration(isUnderline, Boolean(checked))}
            />
            Line-through
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={isItalic}
              onCheckedChange={(checked) => applyStyle('fontStyle', checked ? 'italic' : 'normal')}
            />
            Italic
          </label>
        </div>
      </Row>
    </div>
  );
}
