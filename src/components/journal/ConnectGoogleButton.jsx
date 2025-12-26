import React from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';

export default function ConnectGoogleButton() {
  const handleConnect = () => {
    // Trigger Base44's OAuth flow for Google Calendar
    const currentUrl = window.location.href;
    const oauthUrl = `/oauth/authorize?provider=googlecalendar&redirect_uri=${encodeURIComponent(currentUrl)}`;
    window.location.href = oauthUrl;
  };

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-6 text-center">
      <div className="inline-flex p-3 bg-blue-100 rounded-xl mb-4">
        <Calendar className="w-6 h-6 text-blue-600" />
      </div>
      <h3 className="font-semibold text-slate-900 mb-2">Connect Google Calendar</h3>
      <p className="text-sm text-slate-600 mb-4">
        View your upcoming events and sync your tasks while you journal
      </p>
      <Button 
        onClick={handleConnect}
        className="bg-blue-600 hover:bg-blue-700"
      >
        Connect Google Account
      </Button>
      <p className="text-xs text-slate-500 mt-3">
        You'll be redirected to authorize access to your calendar and tasks
      </p>
    </div>
  );
}
