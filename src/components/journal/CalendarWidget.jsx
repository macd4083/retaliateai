import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, Clock, MapPin, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { format, parseISO, isToday, isTomorrow } from 'date-fns';
import { Button } from '@/components/ui/button';
import ConnectGoogleButton from './ConnectGoogleButton';

export default function CalendarWidget() {
  const [expanded, setExpanded] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ['calendar-events'],
    queryFn: async () => {
      const response = await base44.functions.invoke('getCalendarEvents');
      return response.data;
    },
    retry: 1,
    enabled: true,
    refetchOnMount: false,
    refetchInterval: 5 * 60 * 1000,
  });

  // Check if user needs to connect Google account
  if (error?.response?.data?.error || data?.error) {
    return <ConnectGoogleButton />;
  }

  const events = data?.events || [];

  const getDateLabel = (dateStr) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'EEE, MMM d');
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-xl">
            <Calendar className="w-5 h-5 text-blue-600" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-slate-900">Upcoming Events</h3>
            <p className="text-xs text-slate-500">Next 7 days</p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-slate-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-3 max-h-96 overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No upcoming events</p>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-1 h-full bg-blue-500 rounded-full flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-slate-900 mb-1">{event.title}</h4>
                    
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                      <Clock className="w-3 h-3" />
                      <span>{getDateLabel(event.start)}</span>
                      {!event.allDay && (
                        <span>• {format(parseISO(event.start), 'h:mm a')}</span>
                      )}
                    </div>
                    
                    {event.location && (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <MapPin className="w-3 h-3" />
                        <span className="truncate">{event.location}</span>
                      </div>
                    )}
                    
                    {event.description && (
                      <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                        {event.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
