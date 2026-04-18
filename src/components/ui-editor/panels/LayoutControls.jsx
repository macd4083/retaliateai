// @ts-nocheck
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function Row({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-zinc-400">{label}</Label>
      {children}
    </div>
  );
}

function pxOrRaw(value) {
  const parsed = parseFloat(String(value || '0'));
  return Number.isNaN(parsed) ? '' : parsed;
}

export default function LayoutControls({ selectedNode, applyStyle }) {
  const styles = selectedNode?.styles || {};
  const display = styles.display || 'block';
  const position = styles.position || 'static';
  const isFlex = display === 'flex' || display === 'inline-flex';
  const showInset = position !== 'static';

  return (
    <div className="space-y-4">
      <Row label="Display">
        <Select value={display} onValueChange={(value) => applyStyle('display', value)}>
          <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['block', 'flex', 'inline-flex', 'grid', 'inline', 'none'].map((value) => (
              <SelectItem key={value} value={value}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      {isFlex && (
        <Row label="Flex Direction">
          <ToggleGroup
            type="single"
            value={styles.flexDirection || 'row'}
            onValueChange={(value) => value && applyStyle('flexDirection', value)}
            className="justify-start"
          >
            <ToggleGroupItem value="row">Row</ToggleGroupItem>
            <ToggleGroupItem value="column">Column</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      )}

      {isFlex && (
        <div className="grid grid-cols-2 gap-2">
          <Row label="Align Items">
            <Select value={styles.alignItems || 'stretch'} onValueChange={(value) => applyStyle('alignItems', value)}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['flex-start', 'center', 'flex-end', 'stretch', 'baseline'].map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Justify Content">
            <Select value={styles.justifyContent || 'flex-start'} onValueChange={(value) => applyStyle('justifyContent', value)}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Row label="Gap (px)">
          <Input
            type="number"
            value={pxOrRaw(styles.gap)}
            onChange={(event) => applyStyle('gap', `${event.target.value || 0}px`)}
            className="bg-zinc-900 border-zinc-700"
          />
        </Row>
        <Row label="Overflow">
          <Select value={styles.overflow || 'visible'} onValueChange={(value) => applyStyle('overflow', value)}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['visible', 'hidden', 'scroll', 'auto'].map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Row label="Width">
          <Input
            type="text"
            value={styles.width || ''}
            onChange={(event) => applyStyle('width', event.target.value)}
            className="bg-zinc-900 border-zinc-700"
            placeholder="e.g. 100%, 320px, auto"
          />
        </Row>
        <Row label="Height">
          <Input
            type="text"
            value={styles.height || ''}
            onChange={(event) => applyStyle('height', event.target.value)}
            className="bg-zinc-900 border-zinc-700"
            placeholder="e.g. 100%, 240px, auto"
          />
        </Row>
      </div>

      <Row label="Position">
        <Select value={position} onValueChange={(value) => applyStyle('position', value)}>
          <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['static', 'relative', 'absolute', 'fixed', 'sticky'].map((value) => (
              <SelectItem key={value} value={value}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      {showInset && (
        <div className="grid grid-cols-2 gap-2">
          {['top', 'left', 'right', 'bottom'].map((side) => (
            <Row key={side} label={side[0].toUpperCase() + side.slice(1)}>
              <Input
                type="number"
                value={pxOrRaw(styles[side])}
                onChange={(event) => applyStyle(side, `${event.target.value || 0}px`)}
                className="bg-zinc-900 border-zinc-700"
              />
            </Row>
          ))}
        </div>
      )}

      <Row label={`Opacity (${styles.opacity || '1'})`}>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[Number.parseFloat(styles.opacity || '1') || 1]}
          onValueChange={(values) => applyStyle('opacity', String(values[0]))}
        />
      </Row>
    </div>
  );
}
