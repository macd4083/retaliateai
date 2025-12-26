import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Users as UsersIcon, Mail, CheckCircle, XCircle, Loader2, Calendar, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';

export default function Users() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const checkAdmin = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
      setIsAdmin(user.role === 'admin');
      setCheckingAuth(false);
    };
    checkAdmin();
  }, []);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: isAdmin,
  });

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="p-4 bg-red-100 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
            <ShieldAlert className="w-10 h-10 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-600">You must be an admin to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2.5 bg-slate-900 rounded-xl">
            <UsersIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Users</h1>
            <p className="text-slate-500 text-sm">Manage registered users</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Email</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Name</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Role</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Joined</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Terms</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Marketing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-slate-400" />
                          <span className="text-sm text-slate-900 font-medium">{user.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-700">{user.full_name || '-'}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          user.role === 'admin' 
                            ? 'bg-violet-100 text-violet-700' 
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          {format(new Date(user.created_date), 'MMM d, yyyy')}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {user.agreed_to_terms ? (
                          <div className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-xs">Agreed</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-slate-400">
                            <XCircle className="w-4 h-4" />
                            <span className="text-xs">Pending</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {user.marketing_emails_consent ? (
                          <div className="flex items-center gap-1 text-blue-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-xs">Yes</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-slate-400">
                            <XCircle className="w-4 h-4" />
                            <span className="text-xs">No</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {users.length === 0 && (
              <div className="text-center py-12">
                <UsersIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No users yet</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-200">
          <p className="text-sm text-blue-900">
            <strong>Total Users:</strong> {users.length} | 
            <strong className="ml-3">Marketing Consent:</strong> {users.filter(u => u.marketing_emails_consent).length}
          </p>
        </div>
      </div>
    </div>
  );
}