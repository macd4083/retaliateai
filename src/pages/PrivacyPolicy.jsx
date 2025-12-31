import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg: px-8 py-12">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-blue-100 rounded-xl">
              <Shield className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
              <p className="text-sm text-slate-600">Last updated: December 31, 2025</p>
            </div>
          </div>

          <div className="prose prose-slate max-w-none">
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Introduction</h2>
              <p className="text-slate-700 leading-relaxed">
                Welcome to Retaliate AI. We respect your privacy and are committed to protecting your personal data. 
                This privacy policy explains how we collect, use, and safeguard your information when you use our 
                AI-powered journaling application.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Information We Collect</h2>
              
              <h3 className="text-xl font-semibold text-slate-800 mb-3 mt-6">Account Information</h3>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>Email address (for account creation and login)</li>
                <li>Password (encrypted and securely stored)</li>
                <li>Account creation date and last login time</li>
              </ul>

              <h3 className="text-xl font-semibold text-slate-800 mb-3 mt-6">Content You Create</h3>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>Journal entries and their content</li>
                <li>Goals you set and track</li>
                <li>AI-generated insights and summaries</li>
                <li>People and relationships you document</li>
              </ul>

              <h3 className="text-xl font-semibold text-slate-800 mb-3 mt-6">Usage Data</h3>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>How you interact with the application</li>
                <li>Features you use most frequently</li>
                <li>Device and browser information</li>
                <li>IP address and general location (country/region)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">How We Use Your Information</h2>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li><strong>To provide our service:</strong> Store and retrieve your journal entries and goals</li>
                <li><strong>AI analysis:</strong> Generate insights, detect patterns, and provide personalized recommendations</li>
                <li><strong>To improve the app:</strong> Understand usage patterns and enhance features</li>
                <li><strong>Communication:</strong> Send you important updates about your account or service changes</li>
                <li><strong>Security:</strong> Protect against fraud, abuse, and unauthorized access</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">AI and Data Processing</h2>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-slate-700">
                  <strong>Important:</strong> Your journal entries are processed by OpenAI's GPT models to generate 
                  insights and detect patterns. This processing happens securely via encrypted API calls.  OpenAI does 
                  not store or train on your data when using their API per their data usage policies.
                </p>
              </div>
              <p className="text-slate-700 leading-relaxed">
                We use vector embeddings (mathematical representations of your text) to enable semantic search and 
                pattern detection. These embeddings do not contain readable text and cannot be reverse-engineered 
                to reconstruct your original entries.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Data Storage and Security</h2>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li>All data is encrypted in transit using industry-standard SSL/TLS</li>
                <li>Your data is stored securely in Supabase's cloud infrastructure</li>
                <li>Passwords are hashed using bcrypt and never stored in plain text</li>
                <li>We implement row-level security to ensure users can only access their own data</li>
                <li>Regular security audits and updates to protect against vulnerabilities</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Data Sharing and Third Parties</h2>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <p className="text-slate-700">
                  <strong>We never sell your personal data. </strong> Your journal entries are private and confidential. 
                </p>
              </div>
              <p className="text-slate-700 mb-3">We share data only with: </p>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li><strong>OpenAI: </strong> For AI analysis (via secure API, not stored by them)</li>
                <li><strong>Supabase:</strong> Our database and authentication provider</li>
                <li><strong>Vercel:</strong> Our hosting platform</li>
                <li><strong>Legal authorities:</strong> Only if required by law (e.g., valid court order)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Your Rights and Choices</h2>
              <p className="text-slate-700 mb-3">You have the right to:</p>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li><strong>Access: </strong> Request a copy of all your data</li>
                <li><strong>Correction:</strong> Update or correct your information</li>
                <li><strong>Deletion:</strong> Delete your account and all associated data</li>
                <li><strong>Export:</strong> Download your journal entries in JSON format</li>
                <li><strong>Opt-out:</strong> Unsubscribe from marketing emails (if we add this feature)</li>
              </ul>
              <p className="text-slate-700 mt-4">
                To exercise these rights, contact us at <a href="mailto:privacy@retaliateai.com" className="text-blue-600 hover: text-blue-700">privacy@retaliateai. com</a>
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Data Retention</h2>
              <p className="text-slate-700 leading-relaxed">
                We retain your data for as long as your account is active.  If you delete your account, we will 
                permanently delete all your data within 30 days, except where we are required to retain it for 
                legal or regulatory purposes.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Cookies and Tracking</h2>
              <p className="text-slate-700 leading-relaxed mb-3">
                We use minimal cookies and tracking technologies: 
              </p>
              <ul className="list-disc list-inside space-y-2 text-slate-700">
                <li><strong>Authentication cookies:</strong> To keep you logged in</li>
                <li><strong>Session storage:</strong> For temporary app state</li>
                <li><strong>Analytics:</strong> Anonymous usage statistics (if we add analytics)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Children's Privacy</h2>
              <p className="text-slate-700 leading-relaxed">
                Retaliate AI is not intended for users under 13 years of age. We do not knowingly collect 
                personal information from children.  If you believe a child has provided us with personal data, 
                please contact us immediately.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">International Users</h2>
              <p className="text-slate-700 leading-relaxed">
                Your data may be transferred to and processed in the United States or other countries where our 
                service providers operate. By using Retaliate AI, you consent to this transfer. 
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Changes to This Policy</h2>
              <p className="text-slate-700 leading-relaxed">
                We may update this privacy policy from time to time. We will notify you of significant changes 
                via email or a notice in the app. Your continued use of the service after changes constitutes 
                acceptance of the updated policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-slate-900 mb-4">Contact Us</h2>
              <p className="text-slate-700 leading-relaxed">
                If you have questions about this privacy policy or our data practices, please contact us: 
              </p>
              <div className="bg-slate-50 rounded-lg p-4 mt-4">
                <p className="text-slate-700">
                  <strong>Email:</strong> <a href="mailto:privacy@retaliateai.com" className="text-blue-600 hover: text-blue-700">privacy@retaliateai.com</a><br/>
                  <strong>Website: </strong> <a href="https://retaliateai.com" className="text-blue-600 hover:text-blue-700">https://retaliateai.com</a>
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}