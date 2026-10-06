import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT, EFFECTIVE, SOURCE } from "../legal";

export const metadata: Metadata = {
  title: "Terms of Service · Intent Studio",
  description: "The rules for using Intent Studio, a demonstration AI image and video studio.",
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>Effective {EFFECTIVE}</p>
      <p>
        These terms apply when you use Intent Studio (&ldquo;the app&rdquo;). By using it, you agree to them. If you don&rsquo;t agree, please don&rsquo;t use
        the app. How we handle your data is described in the <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>A demonstration, not a product</h2>
      <p>
        Intent Studio is a portfolio project that shows how an AI media studio can be built. It is not a commercial service, it may change, break,
        be reset or be taken offline at any time, and there is no customer support or service-level commitment.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You can use the app as a guest or sign in with Google or an email link. Keep access to your email and Google account secure.</li>
        <li>You must be at least 16 years old to use the app.</li>
        <li>One person, one account: don&rsquo;t create multiple accounts to collect extra free credits.</li>
      </ul>

      <h2>Credits</h2>
      <ul>
        <li>Credits are free demonstration units. They cannot be bought, sold, transferred or exchanged for money, and they have no cash value.</li>
        <li>A run&rsquo;s cost is shown before you start it. Credits are charged only for a finished result; failed or cancelled runs are refunded.</li>
        <li>Balances may be adjusted or reset, for example when the demo is reset or if credits were obtained by abuse.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Don&rsquo;t use Intent Studio to create, upload or share content that:</p>
      <ul>
        <li>is illegal, or promotes violence, terrorism or self-harm;</li>
        <li>sexualises minors in any way, or is sexually explicit;</li>
        <li>depicts real people in a deceptive, sexual, defamatory or harassing way, or impersonates someone without their consent;</li>
        <li>infringes someone else&rsquo;s copyright, trademark, privacy or other rights;</li>
        <li>is designed to deceive, such as misleading political content or fraud.</li>
      </ul>
      <p>
        Also don&rsquo;t attempt to break, overload, reverse-engineer around the app&rsquo;s limits, or access other people&rsquo;s data. The AI providers that run
        the models (Hugging Face and fal.ai) have their own content policies, which also apply. We may remove content or suspend accounts that
        break these rules.
      </p>

      <h2>Your content</h2>
      <ul>
        <li>You keep whatever rights you have in your prompts and the images you upload.</li>
        <li>You give us permission to store and process them, and to send them to our AI providers, only as needed to run the app for you.</li>
        <li>
          Generated results are produced by third-party AI models (such as Stable Diffusion 3 Medium, FLUX.1 schnell and Wan 2.2), and your use of
          them is subject to those models&rsquo; licenses. AI output can be inaccurate, unexpected or similar to existing works; you are responsible
          for checking it before you use or publish it.
        </li>
        <li>Results are stored at unguessable but unprotected links. Don&rsquo;t generate anything you need to keep confidential.</li>
      </ul>

      <h2>The software</h2>
      <p>
        Intent Studio&rsquo;s source code is available under the MIT License at <a href={SOURCE}>{SOURCE.replace("https://", "")}</a>. That license
        governs the code; these terms govern use of this hosted demonstration.
      </p>

      <h2>No warranty</h2>
      <p>
        The app is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, express or implied, including fitness for a
        particular purpose, availability, accuracy of results, or preservation of your data.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, the project&rsquo;s maintainers are not liable for any indirect, incidental or consequential damages,
        or for any loss of data, content or profits, arising from your use of the app. Because the app is free, our total liability for any claim
        is limited to zero, except where the law does not allow such a limit.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using the app at any time, and ask for your account to be deleted as described in the Privacy Policy. We may suspend or end
        access, or shut the demonstration down, at any time.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; the effective date above will change when we do. Questions can be raised on{" "}
        <a href={CONTACT}>the project&rsquo;s issue tracker</a>.
      </p>
    </>
  );
}
