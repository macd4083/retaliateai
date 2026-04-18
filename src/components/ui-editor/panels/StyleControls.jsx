// @ts-nocheck
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function normalizeColor(value, fallback = '#000000') {
  if (!value) return fallback;
  if (value.startsWith('#') && (value.length === 7 || value.length === 4)) return value;

  const rgbMatch = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    const toHex = (v) => Number(v).toString(16).padStart(2, '0');
    return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
  }

  return fallback;
}

function Row({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-zinc-400">{label}</Label>
      {children}
    </div>
  );
}

const SHADOW_PRESETS = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
};

export default function StyleControls({ selectedNode, applyStyle, applyAttr }) {
  const styles = selectedNode?.styles || {};
  const bgHex = normalizeColor(styles.backgroundColor, '#000000');
  const borderHex = normalizeColor(styles.borderColor, '#ffffff');
  const borderRadius = parseFloat(String(styles.borderRadius || '0')) || 0;
  const borderWidth = parseFloat(String(styles.borderWidth || '0')) || 0;

  return (
    <div className="space-y-4">
      <Row label="Background Color">
        <div className="flex gap-2">
          <Input
            type="color"
            value={bgHex}
            onChange={(event) => applyStyle('backgroundColor', event.target.value)}
            className="w-12 p-1 bg-zinc-900 border-zinc-700"
          />
          <Input
            value={bgHex}
            onChange={(event) => applyStyle('backgroundColor', event.target.value)}
            className="bg-zinc-900 border-zinc-700"
          />
        </div>
      </Row>

      <Row label="Background Image URL">
        <Input
          value={String(styles.backgroundImage || '').replace(/^url\((.*)\)$/i, '$1').replace(/"/g, '')}
          onChange={(event) => {
            const value = event.target.value.trim();
            applyStyle('backgroundImage', value ? `url(${value})` : 'none');
          }}
          className="bg-zinc-900 border-zinc-700"
          placeholder="https://..."
        />
      </Row>

      <div className="grid grid-cols-2 gap-2">
        <Row label="Border Width (px)">
          <Input
            type="number"
            value={borderWidth}
            onChange={(event) => applyStyle('borderWidth', `${event.target.value || 0}px`)}
            className="bg-zinc-900 border-zinc-700"
          />
        </Row>
        <Row label="Border Style">
          <Select value={styles.borderStyle || 'none'} onValueChange={(value) => applyStyle('borderStyle', value)}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['none', 'solid', 'dashed', 'dotted', 'double'].map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </div>

      <Row label="Border Color">
        <Input
          type="color"
          value={borderHex}
          onChange={(event) => applyStyle('borderColor', event.target.value)}
          className="w-12 p-1 bg-zinc-900 border-zinc-700"
        />
      </Row>

      <Row label={`Border Radius (${Math.round(borderRadius)}px)`}>
        <div className="flex items-center gap-2">
          <Slider
            min={0}
            max={50}
            step={1}
            value={[borderRadius]}
            onValueChange={(values) => applyStyle('borderRadius', `${values[0]}px`)}
          />
          <Input
            type="number"
            value={Math.round(borderRadius)}
            onChange={(event) => applyStyle('borderRadius', `${event.target.value || 0}px`)}
            className="w-20 bg-zinc-900 border-zinc-700"
          />
        </div>
      </Row>

      <Row label="Box Shadow">
        <Select
          value={Object.keys(SHADOW_PRESETS).find((key) => SHADOW_PRESETS[key] === (styles.boxShadow || 'none')) || 'none'}
          onValueChange={(value) => applyStyle('boxShadow', SHADOW_PRESETS[value] || 'none')}
        >
          <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.keys(SHADOW_PRESETS).map((preset) => (
              <SelectItem key={preset} value={preset}>{preset}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={styles.boxShadow || 'none'}
          onChange={(event) => applyStyle('boxShadow', event.target.value)}
          className="bg-zinc-900 border-zinc-700 mt-2"
          placeholder="Custom shadow"
        />
      </Row>

      <Row label="Cursor">
        <Select value={styles.cursor || 'default'} onValueChange={(value) => applyStyle('cursor', value)}>
          <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['default', 'pointer', 'not-allowed', 'grab', 'crosshair', 'text'].map((value) => (
              <SelectItem key={value} value={value}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <Row label="Tailwind Classes">
        <Input
          value={selectedNode?.className || ''}
          onChange={(event) => applyAttr('class', event.target.value)}
          className="bg-zinc-900 border-zinc-700"
          placeholder="e.g. text-sm font-semibold"
        />
      </Row>
    </div>
  );
}
