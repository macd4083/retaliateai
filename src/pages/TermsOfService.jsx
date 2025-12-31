import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';

export default function TermsOfService() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-purple-100 rounded-xl">
              <FileText className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Terms of Service</h1>
              <p className="text-sm text-slate-600">Last updated: December 31, 2025</p>
            </div>
          </div>

          <div className="prose prose-slate max-w-none">
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Agreement to Terms</h2>
              <p className="text-slate-700 leading-relaxed">
                By accessing or using Retaliate AI, you agree to be bound by these Terms of Service and our Privacy Policy.  
                If you do not agree to these terms, please do not use our service.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Description of Service</h2>
              <p className="text-slate-700 leading-relaxed mb-3">
                Retaliate AI is an AI-powered journaling application that provides: 
              </p>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>Digital journaling with AI-generated insights and analysis</li>
                <li>Pattern detection across your journal entries</li>
                <li>Goal tracking and progress monitoring</li>
                <li>Personalized recommendations and follow-up questions</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Account Registration</h2>
              <p className="text-slate-700 leading-relaxed mb-3">
                To use Retaliate AI, you must: 
              </p>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>Be at least 13 years of age</li>
                <li>Provide accurate and complete information</li>
                <li>Maintain the security of your account credentials</li>
                <li>Notify us immediately of any unauthorized access</li>
                <li>Accept responsibility for all activities under your account</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Acceptable Use</h2>
              <p className="text-slate-700 mb-3">You agree NOT to:</p>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>Use the service for any illegal purpose</li>
                <li>Attempt to gain unauthorized access to our systems</li>
                <li>Interfere with or disrupt the service</li>
                <li>Use automated scripts or bots to access the service</li>
                <li>Share your account with others</li>
                <li>Reverse engineer or copy any part of our technology</li>
                <li>Use the service to harm, threaten, or harass others</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Your Content</h2>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-slate-700">
                  <strong>You retain ownership</strong> of all content you create in Retaliate AI, including journal 
                  entries, goals, and any other data. 
                </p>
              </div>
              <p className="text-slate-700 leading-relaxed mb-3">
                By using our service, you grant us a limited license to: 
              </p>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>Store and display your content within the application</li>
                <li>Process your content through AI to generate insights</li>
                <li>Back up your data for disaster recovery</li>
                <li>Use anonymous, aggregated data to improve our service</li>
              </ul>
              <p className="text-slate-700 mt-4">
                We will never sell your content or share it with third parties for marketing purposes.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">AI-Generated Content</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <p className="text-slate-700">
                  <strong>Important:</strong> AI-generated insights are meant to support your self-reflection, not 
                  replace professional advice. 
                </p>
              </div>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>AI insights may not always be accurate or appropriate</li>
                <li>We are not responsible for decisions made based on AI recommendations</li>
                <li>Our service is not a substitute for professional medical, psychiatric, or therapeutic care</li>
                <li>If you are experiencing a mental health crisis, please contact a qualified professional</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Pricing and Payment</h2>
              <p className="text-slate-700 leading-relaxed">
                Retaliate AI is currently offered free of charge. If we introduce paid features in the future: 
              </p>
              <ul className="list-disc list-inside space-y-2 text-slate-700 mt-3">
                <li>We will provide advance notice before charging</li>
                <li>You can choose to continue with free features or upgrade</li>
                <li>All charges will be clearly disclosed</li>
                <li>Refund policies will be provided at the time of purchase</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Service Availability</h2>
              <p className="text-slate-700 leading-relaxed">
                We strive to provide reliable service, but we cannot guarantee: 
              </p>
              <ul className="list-disc list-inside space-y-2 text-slate-700 mt-3">
                <li>Uninterrupted access to the service</li>
                <li>Error-free operation</li>
                <li>That the service will meet all your requirements</li>
              </ul>
              <p className="text-slate-700 mt-4">
                We may suspend or terminate the service for maintenance, updates, or other reasons with or without notice.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Termination</h2>
              <p className="text-slate-700 mb-3"><strong>You may: </strong></p>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>Stop using the service at any time</li>
                <li>Delete your account and all data from your settings</li>
              </ul>
              <p className="text-slate-700 mb-3 mt-4"><strong>We may:</strong></p>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>Suspend or terminate your account for violating these terms</li>
                <li>Discontinue the service with reasonable notice</li>
                <li>Remove content that violates our policies</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Disclaimer of Warranties</h2>
              <div className="bg-slate-100 border border-slate-300 rounded-lg p-4">
                <p className="text-slate-700">
                  THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS 
                  OR IMPLIED.  WE DISCLAIM ALL WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, 
                  AND NON-INFRINGEMENT. 
                </p>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Limitation of Liability</h2>
              <p className="text-slate-700 leading-relaxed">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, RETALIATE AI SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, 
                SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED 
                DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, OR GOODWILL. 
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Indemnification</h2>
              <p className="text-slate-700 leading-relaxed">
                You agree to indemnify and hold harmless Retaliate AI from any claims, damages, or expenses arising 
                from your use of the service, violation of these terms, or infringement of any rights of others.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Changes to Terms</h2>
              <p className="text-slate-700 leading-relaxed">
                We may modify these terms at any time. We will notify you of material changes via email or in-app notice. 
                Continued use of the service after changes constitutes acceptance of the new terms.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Governing Law</h2>
              <p className="text-slate-700 leading-relaxed">
                These terms are governed by the laws of [Your State/Country], without regard to conflict of law principles.  
                Any disputes shall be resolved in the courts of [Your Jurisdiction].
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Contact Us</h2>
              <p className="text-slate-700 leading-relaxed">
                Questions about these terms? Contact us: 
              </p>
              <div className="bg-slate-50 rounded-lg p-4 mt-4">
                <p className="text-slate-700">
                  <strong>Email:</strong> <a href="mailto:legal@retaliateai.com" className="text-blue-600 hover:text-blue-700">legal@retaliateai.com</a><br/>
                  <strong>Website:</strong> <a href="https://retaliateai.com" className="text-blue-600 hover:text-blue-700">https://retaliateai.com</a>
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}