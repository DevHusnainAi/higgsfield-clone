import type { Metadata } from "next";
import { CONTACT, EFFECTIVE, SOURCE } from "../legal";

export const metadata: Metadata = {
  title: "Privacy Policy · Intent Studio",
  description: "What Intent Studio collects, why, who processes it, and how to have it deleted.",
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Effective {EFFECTIVE}</p>
      <p>
        This policy explains what Intent Studio (&ldquo;we&rdquo;, &ldquo;the app&rdquo;) collects when you use it, why, and who else handles it. Intent Studio
        turns text prompts into AI-generated images and videos. Its source code is public at <a href={SOURCE}>{SOURCE.replace("https://", "")}</a>, so
        everything described here can be checked against the code.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details.</strong> When you first open the app you get an anonymous guest account, identified only by a random ID. If you
          sign in, we store your email address and, if you use Google, the basic profile Google shares (your name and email). We never receive
          your Google password.
        </li>
        <li>
          <strong>What you create.</strong> Your prompts, the settings of each run (format, aspect ratio, duration, model, seed), the resulting
          images and videos, and any start-frame images you upload.
        </li>
        <li>
          <strong>Credits.</strong> Your credit balance and a record of what each run held, charged or refunded.
        </li>
        <li>
          <strong>Technical data.</strong> Your IP address is used for rate limiting to prevent abuse. Our hosting provider keeps standard server
          logs (such as IP address, time and requested page) for operating and securing the service.
        </li>
        <li>
          <strong>Stored in your browser.</strong> Your sign-in session, a cached copy of your history so it works offline, your favorites and
          interface preferences. These live in your browser&rsquo;s local storage, not in cookies.
        </li>
      </ul>
      <p>We do not use advertising, analytics or tracking cookies, and we do not sell, rent or share your data for marketing.</p>

      <h2>How we use it</h2>
      <ul>
        <li>To generate what you ask for, show you your history, and keep your credit balance accurate.</li>
        <li>To let you sign in and keep your work across devices.</li>
        <li>To protect the service from abuse, for example by limiting how many requests one account or network can make.</li>
        <li>To diagnose errors and keep the service running.</li>
      </ul>

      <h2>Who processes your data</h2>
      <p>We rely on a small number of service providers, each of which handles only what it needs for its part of the service:</p>
      <ul>
        <li>
          <strong>Supabase</strong> stores your account, history, credit balance and files (authentication, database and file storage).
        </li>
        <li>
          <strong>Hugging Face</strong> and <strong>fal.ai</strong> run the AI models. When you start a run, your prompt, its settings and any start
          frame you attached are sent to them to produce the result. Their own privacy policies apply to that processing.
        </li>
        <li>
          <strong>Google</strong> handles sign-in if you choose &ldquo;Continue with Google&rdquo;.
        </li>
        <li>
          <strong>An email delivery provider</strong> sends sign-in links if you sign in by email.
        </li>
        <li>
          <strong>Vercel</strong> hosts the app.
        </li>
      </ul>

      <h2>Google user data</h2>
      <p>
        If you sign in with Google, we request only your basic profile and email address, and use them only to create and identify your account.
        Intent Studio&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use
        requirements. We do not use Google user data for advertising and do not transfer it to others except the service providers above, as
        needed to run the app.
      </p>

      <h2>Who can see your results</h2>
      <p>
        Your history is private to your account. However, finished images and videos are stored at long, randomly generated web addresses that
        cannot be guessed but are not password-protected: anyone you give a result&rsquo;s link to can open it. Start-frame images you upload are
        private to your account.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Because this is a demonstration, we keep data only as long as the demo runs, and we may reset or delete accounts, history and files at
        any time without notice. Rate-limiting records are short-lived. Do not use Intent Studio to store anything you need to keep.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>You can use the app as a guest without giving us any personal details.</li>
        <li>You can delete your uploaded start frames at any time from the start-frame library.</li>
        <li>
          You can ask us to access, correct or delete your account and everything associated with it via <a href={CONTACT}>the project&rsquo;s issue
          tracker</a>. Please don&rsquo;t post personal details there: just ask, and we&rsquo;ll arrange a private channel.
        </li>
        <li>Signing out clears your history from that browser.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit. Access to your records is restricted to your account by database security rules, and all changes to
        credits go through server-side checks. No system is perfectly secure, and as a demonstration Intent Studio comes with no guarantees; see
        the Terms of Service.
      </p>

      <h2>Children</h2>
      <p>Intent Studio is not intended for children under 16, and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>If this policy changes, we will update this page and its effective date.</p>
    </>
  );
}
