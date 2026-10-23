import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BusFront, CheckCircle2, Mail, ShieldCheck } from 'lucide-react';
import { ErrorMessage, post, useAuth } from '../api';

export function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(() => params.get('token') || '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(() => Boolean(params.get('token')));
  const role = params.get('role') || 'student';
  const destination = (userRole: string) =>
    userRole === 'DRIVER' ? '/driver' : userRole === 'ADMIN' ? '/admin' : '/live';
  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      await post('/auth/email/verify', { token: value });
      const result = (await auth.refresh()) as { data?: { user?: { role: string } } };
      navigate(destination(result.data?.user?.role || 'STUDENT'), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (params.has('token'))
      setParams(
        (previous) => {
          previous.delete('token');
          return previous;
        },
        { replace: true },
      );
  }, []);
  async function send(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post('/auth/email/start', { email });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function demo(persona: string) {
    setBusy(true);
    setError(null);
    try {
      const user = await auth.loginDemo(persona);
      if (user) navigate(destination(user.role));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container section auth-layout">
      <div className="auth-intro">
        <span className="eyebrow">
          <ShieldCheck size={16} /> A SAFER CAMPUS COMMUTE
        </span>
        <h1>
          ক্যাম্পাসের সাথে
          <br />
          <em>সংযোগটা থাকুক।</em>
        </h1>
        <p>
          লাল বাসের পথে আপনার নিজের জায়গা। বিশ্ববিদ্যালয়ের ইমেইল যাচাই করুন, তারপর বাসের অবস্থান
          দেখুন।
        </p>
        <img src="/illustrations/heritage-bus.svg" alt="Crimson campus bus illustration" />
        <p className="muted">
          No student location is collected. Driver GPS is private outside active trips.
        </p>
      </div>
      <section className="auth-card">
        <span className="brand-icon">
          <BusFront size={25} />
        </span>
        <h2>
          {role === 'driver'
            ? 'চালক লগইন'
            : role === 'admin'
              ? 'প্রশাসক লগইন'
              : 'স্বাগতম, শিক্ষার্থী।'}
        </h2>
        <p className="muted">
          {role === 'student'
            ? 'Sign in with your verified DU academic email.'
            : 'Use your pre-approved account email. No public staff registration.'}
        </p>
        <ErrorMessage error={error} />
        {sent ? (
          <div className="notice">
            <CheckCircle2 size={25} />
            <div>
              <strong>ইমেইল দেখুন</strong>
              <p>
                If eligible, a single-use verification link was sent. It expires shortly. Open it on
                this device.
              </p>
            </div>
          </div>
        ) : (
          <form className="form-stack" onSubmit={(event) => void send(event)}>
            <label className="field">
              {role === 'student' ? 'DU academic email' : 'Approved account email'}
              <input
                type="email"
                autoComplete="email"
                required
                placeholder={
                  role === 'student' ? 'your.name@du.ac.bd' : 'Your approved staff email'
                }
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy} type="submit">
              <Mail size={18} />
              {busy ? 'অপেক্ষা করুন…' : 'নিরাপদ লগইন লিংক পাঠান'}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
        {sent && (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void verify(token);
            }}
          >
            <label className="field">
              Or paste the verification token
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="one-time-code"
                required
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Verify email
            </button>
          </form>
        )}
        <p className="auth-small">
          Email ownership is verified on the server. Domain rules are configured by the transport
          administrator.
        </p>
        {auth.demoEnabled && (
          <>
            <div className="divider">
              <span>LOCAL DEVELOPMENT ONLY</span>
            </div>
            <div className="notice slim">
              <span className="badge demo">DEMO</span> These personas simulate identity; they are
              not verified university accounts.
            </div>
            <div className="demo-grid">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void demo('student')}
              >
                Demo student
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void demo('driver')}
              >
                Demo driver
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void demo('admin')}
              >
                Demo admin
              </button>
              <button
                className="button ghost"
                disabled={busy}
                onClick={() => void demo('unapproved')}
              >
                Unapproved driver test
              </button>
            </div>
          </>
        )}
        <div className="auth-links">
          <Link to="/login?role=student">Student</Link>
          <Link to="/login?role=driver">Driver</Link>
          <Link to="/login?role=admin">Administrator</Link>
        </div>
      </section>
    </div>
  );
}
