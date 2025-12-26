import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, Mail } from "lucide-react";

export default function TermsAgreement({ onAccept }) {
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(true);

  const handleAccept = () => {
    onAccept({
      agreed_to_terms: true,
      terms_agreed_date: new Date().toISOString(),
      marketing_emails_consent: marketingConsent
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl">
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-900 rounded-xl">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Welcome to Reflect</h2>
              <p className="text-slate-500 text-sm">Please review our terms and privacy policy</p>
            </div>
          </div>
        </div>

        <ScrollArea className="h-[400px] p-6">
          <div className="space-y-6 text-slate-700">
            <section>
              <h3 className="font-semibold text-lg text-slate-900 mb-2">Terms of Service</h3>
              <p className="text-sm leading-relaxed">
                By using Reflect, you agree to our terms of service. This AI-powered journaling app 
                helps you track your thoughts, goals, and personal growth. Your journal entries are private 
                and secured.
              </p>
            </section>

            <section>
              <h3 className="font-semibold text-lg text-slate-900 mb-2">Privacy Policy</h3>
              <p className="text-sm leading-relaxed mb-3">
                We collect and process the following information:
              </p>
              <ul className="text-sm space-y-2 list-disc list-inside">
                <li>Your email address for account identification</li>
                <li>Journal entries, goals, and people you track</li>
                <li>AI-generated insights based on your entries</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-lg text-slate-900 mb-2">How We Use Your Data</h3>
              <ul className="text-sm space-y-2 list-disc list-inside">
                <li>To provide personalized AI insights and feedback</li>
                <li>To track your progress toward goals</li>
                <li>To improve our service and features</li>
                <li>Your data is never shared with third parties</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-lg text-slate-900 mb-2">Your Rights</h3>
              <p className="text-sm leading-relaxed">
                You have the right to access, modify, or delete your data at any time. 
                You can export or delete your account from your settings.
              </p>
            </section>

            <section>
              <h3 className="font-semibold text-lg text-slate-900 mb-2">AI Processing</h3>
              <p className="text-sm leading-relaxed">
                Your journal entries are analyzed by AI to provide insights, pattern detection, 
                and personalized feedback. This processing happens securely and privately.
              </p>
            </section>
          </div>
        </ScrollArea>

        <div className="p-6 border-t border-slate-200 space-y-4">
          <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl">
            <Checkbox
              id="terms"
              checked={agreedToTerms}
              onCheckedChange={setAgreedToTerms}
              className="mt-1"
            />
            <label htmlFor="terms" className="text-sm text-slate-700 cursor-pointer">
              I have read and agree to the Terms of Service and Privacy Policy. I understand 
              my data will be used to provide personalized AI insights.
            </label>
          </div>

          <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-200">
            <Checkbox
              id="marketing"
              checked={marketingConsent}
              onCheckedChange={setMarketingConsent}
              className="mt-1"
            />
            <label htmlFor="marketing" className="text-sm text-slate-700 cursor-pointer flex items-start gap-2">
              <Mail className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <span>
                <strong className="text-blue-900">Optional:</strong> I consent to receiving marketing 
                emails and product updates about Reflect and related services.
              </span>
            </label>
          </div>

          <Button
            onClick={handleAccept}
            disabled={!agreedToTerms}
            className="w-full bg-slate-900 hover:bg-slate-800 py-6 text-base"
          >
            Accept and Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
