import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import AppShellV2 from '../components/v2/AppShellV2';
import RecorderToolbar from '../components/recorder/RecorderToolbar';
import DiffViewer from '../components/recorder/DiffViewer';
import InlineEditor from '../components/recorder/InlineEditor';
import ChangeLogPanel from '../components/recorder/ChangeLogPanel';
import ExportPanel from '../components/recorder/ExportPanel';
import useRecorder from '../hooks/useRecorder';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';

export default function UIRecorder() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isAdmin, setIsAdmin] = useState(null);
  const [viewMode, setViewMode] = useState('unified');
  const [activeTab, setActiveTab] = useState('diff');
  const [exportOpen, setExportOpen] = useState(false);

  const {
    status,
    currentHTML,
    diffLines,
    diffStats,
    changes,
    startRecording,
    stopRecording,
    resetRecorder,
    updateCurrentHTML,
    exportPatch,
    exportJson,
    clearChanges,
  } = useRecorder();

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.role === 'admin') {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
          navigate('/reflection', { replace: true });
        }
      })
      .catch(() => {
        setIsAdmin(false);
        navigate('/reflection', { replace: true });
      });
  }, [user?.id]);

  const hasDiff = useMemo(
    () => (diffStats.additions + diffStats.deletions) > 0,
    [diffStats.additions, diffStats.deletions],
  );

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <AppShellV2 title="UI Recorder">
      <div className="h-full overflow-hidden px-4 py-4 md:py-6 flex flex-col gap-4">
        <RecorderToolbar
          status={status}
          diffStats={diffStats}
          changesCount={changes.length}
          onStart={() => {
            setActiveTab('diff');
            startRecording(document.documentElement);
          }}
          onStop={stopRecording}
          onReset={() => {
            setExportOpen(false);
            resetRecorder();
          }}
          onExportPatch={() => exportPatch('ui-recorder.patch')}
          onExportJson={() => exportJson({ adminId: user?.id, pageURL: window.location.href }, 'ui-recorder.json')}
        />

        {status === 'idle' ? (
          <div className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/50 flex items-center justify-center p-6">
            <div className="text-center max-w-xl space-y-4">
              <h2 className="text-xl font-semibold text-white">UI Recorder</h2>
              <p className="text-zinc-400 text-sm">Capture DOM mutations, inspect code diffs, edit HTML inline, and export patch/JSON changelogs.</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="px-2.5 py-1 rounded-lg text-xs bg-zinc-800 border border-zinc-700 text-zinc-300">MutationObserver</span>
                <span className="px-2.5 py-1 rounded-lg text-xs bg-zinc-800 border border-zinc-700 text-zinc-300">ResizeObserver</span>
                <span className="px-2.5 py-1 rounded-lg text-xs bg-zinc-800 border border-zinc-700 text-zinc-300">Unified + Split Diff</span>
                <span className="px-2.5 py-1 rounded-lg text-xs bg-zinc-800 border border-zinc-700 text-zinc-300">Patch + JSON Export</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex gap-4">
            <div className="hidden md:block w-64 flex-shrink-0 min-h-0">
              <ChangeLogPanel changes={changes} onClear={clearChanges} />
            </div>

            <div className="flex-1 min-h-0 flex flex-col gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2 flex items-center gap-1">
                <button
                  onClick={() => setActiveTab('diff')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${activeTab === 'diff' ? 'bg-red-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
                >
                  Code Diff
                </button>
                <button
                  onClick={() => setActiveTab('editor')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${activeTab === 'editor' ? 'bg-red-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
                >
                  Inline Editor
                </button>
                <button
                  onClick={() => setActiveTab('log')}
                  className={`md:hidden px-3 py-1.5 rounded-lg text-xs font-medium ${activeTab === 'log' ? 'bg-red-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
                >
                  Log ({changes.length})
                </button>

                {status === 'stopped' && hasDiff && (
                  <button
                    onClick={() => setExportOpen(true)}
                    className="ml-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-white hover:bg-zinc-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export ↓
                  </button>
                )}
              </div>

              <div className="flex-1 min-h-0">
                {activeTab === 'diff' && (
                  <DiffViewer
                    diffLines={diffLines}
                    diffStats={diffStats}
                    viewMode={viewMode}
                    onChangeViewMode={setViewMode}
                  />
                )}

                {activeTab === 'editor' && (
                  <InlineEditor
                    html={currentHTML}
                    onChange={updateCurrentHTML}
                    disabled={status === 'recording'}
                  />
                )}

                {activeTab === 'log' && (
                  <ChangeLogPanel changes={changes} onClear={clearChanges} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <ExportPanel
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        diffLines={diffLines}
        diffStats={diffStats}
        changes={changes}
        onExportPatch={() => exportPatch('ui-recorder.patch')}
        onExportJson={() => exportJson({ adminId: user?.id, pageURL: window.location.href }, 'ui-recorder.json')}
      />
    </AppShellV2>
  );
}
