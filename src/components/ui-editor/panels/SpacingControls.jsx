// @ts-nocheck
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link2, Unlink2 } from 'lucide-react';

function pxValue(value) {
  const parsed = parseFloat(String(value || '0'));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function EditableValue({ value, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value));

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setLocal(String(value));
          setEditing(true);
        }}
        className="text-xs font-medium text-zinc-200 hover:text-white"
      >
        {value}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      type="number"
      value={local}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={() => {
        onCommit(local);
        setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onCommit(local);
          setEditing(false);
        }
      }}
      className="h-6 w-16 text-xs bg-zinc-900 border-zinc-600"
    />
  );
}

function SidesInputs({ label, values, linked, setLinked, onChange }) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-zinc-400">{label}</Label>
        <Button
          size="icon"
          variant="ghost"
          type="button"
          onClick={() => setLinked((current) => !current)}
          className="w-7 h-7 text-zinc-400 hover:text-white"
        >
          {linked ? <Link2 className="w-4 h-4" /> : <Unlink2 className="w-4 h-4" />}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {sides.map((side) => (
          <Input
            key={side}
            type="number"
            value={values[side.toLowerCase()]}
            onChange={(event) => onChange(side.toLowerCase(), event.target.value)}
            className="bg-zinc-900 border-zinc-700"
            placeholder={side}
          />
        ))}
      </div>
    </div>
  );
}

export default function SpacingControls({ selectedNode, applyStyles }) {
  const styles = selectedNode?.styles || {};

  const [marginLinked, setMarginLinked] = useState(false);
  const [paddingLinked, setPaddingLinked] = useState(false);

  const margin = {
    top: pxValue(styles.marginTop),
    right: pxValue(styles.marginRight),
    bottom: pxValue(styles.marginBottom),
    left: pxValue(styles.marginLeft),
  };

  const padding = {
    top: pxValue(styles.paddingTop),
    right: pxValue(styles.paddingRight),
    bottom: pxValue(styles.paddingBottom),
    left: pxValue(styles.paddingLeft),
  };

  function updateMargin(side, value) {
    const px = `${value || 0}px`;
    if (marginLinked) {
      applyStyles({ marginTop: px, marginRight: px, marginBottom: px, marginLeft: px });
      return;
    }

    const key = `margin${side[0].toUpperCase()}${side.slice(1)}`;
    applyStyles({ [key]: px });
  }

  function updatePadding(side, value) {
    const px = `${value || 0}px`;
    if (paddingLinked) {
      applyStyles({ paddingTop: px, paddingRight: px, paddingBottom: px, paddingLeft: px });
      return;
    }

    const key = `padding${side[0].toUpperCase()}${side.slice(1)}`;
    applyStyles({ [key]: px });
  }

  return (
    <div className="space-y-4">
      <SidesInputs
        label="Margin"
        values={margin}
        linked={marginLinked}
        setLinked={setMarginLinked}
        onChange={updateMargin}
      />

      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3">
        <div className="text-xs text-zinc-400 mb-2">Box Model</div>
        <div className="bg-amber-500/20 border border-amber-500/40 p-2 text-center text-[11px] text-amber-100">
          Margin
          <div className="grid grid-cols-3 text-amber-50 mt-2 mb-2">
            <div />
            <div className="justify-self-center"><EditableValue value={margin.top} onCommit={(value) => updateMargin('top', value)} /></div>
            <div />
            <div className="justify-self-start"><EditableValue value={margin.left} onCommit={(value) => updateMargin('left', value)} /></div>
            <div className="mx-auto w-full bg-blue-500/20 border border-blue-500/40 p-2 text-[11px] text-blue-100">
              Border
              <div className="bg-green-500/20 border border-green-500/40 p-2 mt-2 text-green-100">
                Padding
                <div className="grid grid-cols-3 mt-2 mb-2 text-green-50">
                  <div />
                  <div className="justify-self-center"><EditableValue value={padding.top} onCommit={(value) => updatePadding('top', value)} /></div>
                  <div />
                  <div className="justify-self-start"><EditableValue value={padding.left} onCommit={(value) => updatePadding('left', value)} /></div>
                  <div className="bg-zinc-950 border border-zinc-700 rounded-md py-3 text-zinc-200">Content</div>
                  <div className="justify-self-end"><EditableValue value={padding.right} onCommit={(value) => updatePadding('right', value)} /></div>
                  <div />
                  <div className="justify-self-center"><EditableValue value={padding.bottom} onCommit={(value) => updatePadding('bottom', value)} /></div>
                  <div />
                </div>
              </div>
            </div>
            <div className="justify-self-end"><EditableValue value={margin.right} onCommit={(value) => updateMargin('right', value)} /></div>
            <div />
            <div className="justify-self-center"><EditableValue value={margin.bottom} onCommit={(value) => updateMargin('bottom', value)} /></div>
            <div />
          </div>
        </div>
      </div>

      <SidesInputs
        label="Padding"
        values={padding}
        linked={paddingLinked}
        setLinked={setPaddingLinked}
        onChange={updatePadding}
      />
    </div>
  );
}
