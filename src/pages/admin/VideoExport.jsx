import { useEffect, useState } from 'react';
import VideoExportEngine from '../../components/admin/VideoExportEngine';
import { useAdminToolsStore } from '../../store/adminToolsStore';

export default function VideoExport() {
  const pendingDemoUrl = useAdminToolsStore((state) => state.pendingDemoUrl);
  const clearPendingDemoUrl = useAdminToolsStore((state) => state.clearPendingDemoUrl);
  const [prefillUrl, setPrefillUrl] = useState('');
  const [prefillMessage, setPrefillMessage] = useState('');

  useEffect(() => {
    if (!pendingDemoUrl) return;
    setPrefillUrl(pendingDemoUrl);
    clearPendingDemoUrl();
    setPrefillMessage('Demo URL pre-filled from Demo Builder');
  }, [pendingDemoUrl, clearPendingDemoUrl]);

  return <VideoExportEngine initialDemoUrl={prefillUrl} handoffMessage={prefillMessage} />;
}
