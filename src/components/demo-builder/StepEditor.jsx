import React from 'react';
import { EASING_OPTIONS } from '../../utils/demoSchema';

const HIGHLIGHT_COLORS = ['#ef4444', '#f97316', '#22c55e', '#3b82f6', '#a855f7'];
const POINTER_COLORS = ['#ef4444', '#f97316', '#22c55e', '#3b82f6', '#ffffff'];

function Section({ title, children }) {
  return (
    <section className="border border-zinc-800 rounded-xl p-3 space-y-3 bg-zinc-950">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h4>
      {children}
    </section>
  );
}

function LabeledField({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export default function StepEditor({ selectedStep, updateStep }) {
  if (!selectedStep) {
    return <div className="h-full grid place-items-center text-sm text-zinc-500">Select a step to edit.</div>;
  }

  const updateConfig = (patch) => updateStep(selectedStep.id, { config: patch });

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <Section title="Basic Settings">
        <LabeledField label="Label">
          <input
            value={selectedStep.label}
            onChange={(event) => updateStep(selectedStep.id, { label: event.target.value })}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
          />
        </LabeledField>

        <LabeledField label={`Duration (${selectedStep.duration}ms)`}>
          <input
            type="range"
            min={500}
            max={10000}
            step={100}
            value={selectedStep.duration}
            onChange={(event) => updateStep(selectedStep.id, { duration: Number(event.target.value) })}
            className="w-full accent-red-500"
          />
        </LabeledField>

        <LabeledField label={`Delay (${selectedStep.delay}ms)`}>
          <input
            type="range"
            min={0}
            max={5000}
            step={100}
            value={selectedStep.delay}
            onChange={(event) => updateStep(selectedStep.id, { delay: Number(event.target.value) })}
            className="w-full accent-red-500"
          />
        </LabeledField>

        <LabeledField label="Easing">
          <select
            value={selectedStep.easing}
            onChange={(event) => updateStep(selectedStep.id, { easing: event.target.value })}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
          >
            {EASING_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </LabeledField>

        <LabeledField label="Advance">
          <div className="grid grid-cols-2 gap-2">
            {['auto', 'click'].map((mode) => (
              <button
                key={mode}
                onClick={() => updateStep(selectedStep.id, { advance: mode })}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                  selectedStep.advance === mode
                    ? 'bg-red-600 border-red-700 text-white'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                {mode === 'auto' ? 'Auto' : 'Click'}
              </button>
            ))}
          </div>
        </LabeledField>

        {(selectedStep.type === 'highlight' || selectedStep.type === 'tooltip') && (
          <LabeledField label="CSS Selector">
            <input
              value={selectedStep.selector || ''}
              onChange={(event) => updateStep(selectedStep.id, { selector: event.target.value || null })}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
              placeholder=".cta-button"
            />
          </LabeledField>
        )}
      </Section>

      {selectedStep.type === 'highlight' && (
        <Section title="Highlight Config">
          <LabeledField label="Color">
            <div className="flex gap-2">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => updateConfig({ color })}
                  className={`h-7 w-7 rounded-full border-2 ${selectedStep.config.color === color ? 'border-white' : 'border-zinc-700'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </LabeledField>
          <LabeledField label={`Border Radius (${selectedStep.config.borderRadius}px)`}>
            <input
              type="range"
              min={0}
              max={32}
              value={selectedStep.config.borderRadius}
              onChange={(event) => updateConfig({ borderRadius: Number(event.target.value) })}
              className="w-full accent-red-500"
            />
          </LabeledField>
          <LabeledField label={`Padding (${selectedStep.config.padding}px)`}>
            <input
              type="range"
              min={0}
              max={32}
              value={selectedStep.config.padding}
              onChange={(event) => updateConfig({ padding: Number(event.target.value) })}
              className="w-full accent-red-500"
            />
          </LabeledField>
          <LabeledField label="Pulse">
            <button
              onClick={() => updateConfig({ pulse: !selectedStep.config.pulse })}
              className={`px-3 py-2 rounded-lg border text-sm ${
                selectedStep.config.pulse
                  ? 'bg-red-600 border-red-700 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300'
              }`}
            >
              {selectedStep.config.pulse ? 'Enabled' : 'Disabled'}
            </button>
          </LabeledField>
        </Section>
      )}

      {selectedStep.type === 'tooltip' && (
        <Section title="Tooltip Config">
          <LabeledField label="Text">
            <textarea
              value={selectedStep.config.text}
              onChange={(event) => updateConfig({ text: event.target.value })}
              className="w-full h-24 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            />
          </LabeledField>
          <LabeledField label="Position">
            <div className="grid grid-cols-2 gap-2">
              {['top', 'bottom', 'left', 'right'].map((position) => (
                <button
                  key={position}
                  onClick={() => updateConfig({ position })}
                  className={`px-3 py-2 rounded-lg border text-sm ${
                    selectedStep.config.position === position
                      ? 'bg-red-600 border-red-700 text-white'
                      : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {position}
                </button>
              ))}
            </div>
          </LabeledField>
          <LabeledField label="Arrow">
            <button
              onClick={() => updateConfig({ arrow: !selectedStep.config.arrow })}
              className={`px-3 py-2 rounded-lg border text-sm ${
                selectedStep.config.arrow
                  ? 'bg-red-600 border-red-700 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300'
              }`}
            >
              {selectedStep.config.arrow ? 'Shown' : 'Hidden'}
            </button>
          </LabeledField>
        </Section>
      )}

      {selectedStep.type === 'modal' && (
        <Section title="Modal Config">
          <LabeledField label="Title">
            <input
              value={selectedStep.config.title}
              onChange={(event) => updateConfig({ title: event.target.value })}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            />
          </LabeledField>
          <LabeledField label="Body">
            <textarea
              value={selectedStep.config.body}
              onChange={(event) => updateConfig({ body: event.target.value })}
              className="w-full h-24 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            />
          </LabeledField>
          <LabeledField label="CTA Text">
            <input
              value={selectedStep.config.cta}
              onChange={(event) => updateConfig({ cta: event.target.value })}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            />
          </LabeledField>
          <LabeledField label="CTA Action">
            <select
              value={selectedStep.config.ctaAction}
              onChange={(event) => updateConfig({ ctaAction: event.target.value })}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="next">next</option>
              <option value="close">close</option>
              <option value="url">url</option>
            </select>
          </LabeledField>
          {selectedStep.config.ctaAction === 'url' && (
            <LabeledField label="CTA URL">
              <input
                value={selectedStep.config.ctaUrl}
                onChange={(event) => updateConfig({ ctaUrl: event.target.value })}
                className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
                placeholder="https://..."
              />
            </LabeledField>
          )}
        </Section>
      )}

      {selectedStep.type === 'pointer' && (
        <Section title="Pointer Config">
          <LabeledField label={`X (${selectedStep.config.x}%)`}>
            <input
              type="range"
              min={0}
              max={100}
              value={selectedStep.config.x}
              onChange={(event) => updateConfig({ x: Number(event.target.value) })}
              className="w-full accent-red-500"
            />
          </LabeledField>
          <LabeledField label={`Y (${selectedStep.config.y}%)`}>
            <input
              type="range"
              min={0}
              max={100}
              value={selectedStep.config.y}
              onChange={(event) => updateConfig({ y: Number(event.target.value) })}
              className="w-full accent-red-500"
            />
          </LabeledField>
          <LabeledField label={`Size (${selectedStep.config.size}px)`}>
            <input
              type="range"
              min={12}
              max={80}
              value={selectedStep.config.size}
              onChange={(event) => updateConfig({ size: Number(event.target.value) })}
              className="w-full accent-red-500"
            />
          </LabeledField>
          <LabeledField label="Color">
            <div className="flex gap-2">
              {POINTER_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => updateConfig({ pointerColor: color })}
                  className={`h-7 w-7 rounded-full border-2 ${selectedStep.config.pointerColor === color ? 'border-white' : 'border-zinc-700'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </LabeledField>
          <LabeledField label="Animation">
            <select
              value={selectedStep.config.animation}
              onChange={(event) => updateConfig({ animation: event.target.value })}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="pulse">pulse</option>
              <option value="bounce">bounce</option>
              <option value="click">click</option>
            </select>
          </LabeledField>
        </Section>
      )}

      {selectedStep.type === 'cursor-path' && (
        <Section title="Cursor Path Config">
          <LabeledField label="Path Points">
            <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
              {(selectedStep.config.points || []).map((point, index) => (
                <div key={`${point.x}-${point.y}-${index}`} className="flex items-center gap-2 text-xs text-zinc-300">
                  <span className="w-10 text-zinc-500">#{index + 1}</span>
                  <span>x: {point.x}%</span>
                  <span>y: {point.y}%</span>
                </div>
              ))}
            </div>
          </LabeledField>
          <button
            onClick={() => updateConfig({ points: [...(selectedStep.config.points || []), { x: 50, y: 50 }] })}
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            + Add Point
          </button>
          <LabeledField label="Show Trail">
            <button
              onClick={() => updateConfig({ showTrail: !selectedStep.config.showTrail })}
              className={`px-3 py-2 rounded-lg border text-sm ${
                selectedStep.config.showTrail
                  ? 'bg-red-600 border-red-700 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300'
              }`}
            >
              {selectedStep.config.showTrail ? 'Enabled' : 'Disabled'}
            </button>
          </LabeledField>
        </Section>
      )}

      {selectedStep.type === 'text' && (
        <Section title="Text Config">
          <LabeledField label="Content">
            <textarea
              value={selectedStep.config.content}
              onChange={(event) => updateConfig({ content: event.target.value })}
              className="w-full h-24 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            />
          </LabeledField>
          <LabeledField label={`X (${selectedStep.config.textX}%)`}>
            <input
              type="range"
              min={0}
              max={100}
              value={selectedStep.config.textX}
              onChange={(event) => updateConfig({ textX: Number(event.target.value) })}
              className="w-full accent-red-500"
            />
          </LabeledField>
          <LabeledField label={`Y (${selectedStep.config.textY}%)`}>
            <input
              type="range"
              min={0}
              max={100}
              value={selectedStep.config.textY}
              onChange={(event) => updateConfig({ textY: Number(event.target.value) })}
              className="w-full accent-red-500"
            />
          </LabeledField>
          <LabeledField label="Style">
            <select
              value={selectedStep.config.style}
              onChange={(event) => updateConfig({ style: event.target.value })}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="card">card</option>
              <option value="bubble">bubble</option>
              <option value="inline">inline</option>
            </select>
          </LabeledField>
        </Section>
      )}
    </div>
  );
}
