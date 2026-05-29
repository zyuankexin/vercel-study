import { useState, useEffect, useRef, useCallback } from 'react';

function AuthModal({ onClose, onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [pendingEmail, setPendingEmail] = useState(''); // 待验证的邮箱
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef(null);

  const cooldownRef = useRef(cooldown);
  cooldownRef.current = cooldown;

  // 倒计时（只启动一次 interval）
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // 翻译 Supabase 错误信息
  const translateError = (message) => {
    if (!message) return '操作失败';
    if (message.includes('Email not confirmed')) return '邮箱未验证，请查收验证邮件';
    if (message.includes('Invalid login credentials')) return '邮箱或密码错误';
    if (message.includes('User already registered')) return '该邮箱已被注册，请直接登录';
    if (message.includes('Password should be at least')) return '密码至少需要 6 位';
    if (message.includes('rate limit') || message.includes('60 seconds') || message.includes('too many'))
      return '发送过于频繁，请等待 60 秒后再试';
    return message;
  };

  // 重发验证邮件
  const handleResendEmail = async () => {
    if (cooldown > 0) return;
    setResending(true);
    setMsg('');
    try {
      const { supabase } = await import('../supabaseClient');
      if (!supabase) {
        setMsg('Supabase 未配置，无法发送');
        setResending(false);
        return;
      }
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: pendingEmail,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        console.error('重发验证邮件失败:', error.message, error.status, error);
        const isRateLimit = error.message?.includes('rate limit') || error.message?.includes('60 seconds');
        if (isRateLimit) {
          // 被限速后不再允许重试，避免死循环。请关闭弹窗重新打开后再试。
          setMsg('发送太频繁，请先检查邮箱（包括垃圾箱），关闭弹窗重新打开后可再试');
          setPendingEmail('');
        } else {
          setMsg(translateError(error.message));
        }
      } else {
        console.log('验证邮件已发送至:', pendingEmail);
        setMsg('验证邮件已重新发送，请查收邮箱（包括垃圾箱）。');
        setCooldown(90);
      }
    } catch (err) {
      setMsg(err.message || '发送失败');
    }
    setResending(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMsg('');

    try {
      // 动态导入 supabase，避免未配置时报错
      const { supabase } = await import('../supabaseClient');
      if (!supabase) {
        setMsg('Supabase 未配置，无法登录');
        setSubmitting(false);
        return;
      }

      let result;
      if (isLogin) {
        result = await supabase.auth.signInWithPassword({ email, password });
      } else {
        // 注册前先尝试登录，判断邮箱是否已存在（避免重复创建账号）
        const existingCheck = await supabase.auth.signInWithPassword({ email, password });
        if (!existingCheck.error && existingCheck.data?.session) {
          // 邮箱已注册且已验证，直接登录成功
          result = existingCheck;
        } else if (existingCheck.error?.message?.includes('Email not confirmed')) {
          // 邮箱已注册但未验证，不调用 signUp，直接提示
          setPendingEmail(email);
          setCooldown(90);
          setMsg('该邮箱已注册，请先查收验证邮件后登录。');
          setSubmitting(false);
          return;
        } else {
          // 邮箱不存在或密码错误，执行正常注册流程
          result = await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
        }
      }

      if (result.error) {
        console.error('Auth 操作失败:', isLogin ? '登录' : '注册', result.error.message, result.error);
        setMsg(translateError(result.error.message));
        setSubmitting(false);
        // 登录时如果邮箱未验证，保存邮箱以便重发验证邮件
        if (isLogin && result.error.message?.includes('Email not confirmed')) {
          setPendingEmail(email);
        }
      } else {
        console.log('Auth 操作成功:', isLogin ? '登录' : '注册', result.data?.user?.email, 'email_confirmed_at:', result.data?.user?.email_confirmed_at);
        // 注册后检查邮箱是否已验证
        if (!isLogin && result.data?.user) {
          // 新注册用户，无论 Supabase 配置如何都要求邮箱验证
          const confirmed = !!result.data.user.email_confirmed_at;
          if (!confirmed || !result.data.session) {
            setPendingEmail(email);
            setCooldown(90);
            setMsg('注册成功！请查收邮箱确认链接后登录。');
            setSubmitting(false);
            return;
          }
        }
        setSubmitting(false);
        onAuthSuccess(result.data.user);
      }
    } catch (error) {
      setMsg(error.message || '登录/注册失败');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2 className="modal-title">{isLogin ? '登录' : '注册'}</h2>
        <p className="modal-subtitle">
          {isLogin ? '登录后即可发布歌曲到平台' : '创建账号，开始发布你的音乐'}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>邮箱</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="至少 6 位"
              required
              minLength={6}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          {msg && <div className={`auth-msg${msg.includes('成功') ? ' success' : ''}`}>{msg}</div>}

          {pendingEmail && (
            <button
              type="button"
              className="auth-resend"
              onClick={handleResendEmail}
              disabled={resending || cooldown > 0}
            >
              {resending ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后可重发` : '重新发送验证邮件'}
            </button>
          )}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? '处理中…' : (isLogin ? '登录' : '注册')}
          </button>
        </form>

        <div className="auth-switch">
          {isLogin ? (
            <>还没有账号？<button onClick={() => { setIsLogin(false); setMsg(''); setPendingEmail(''); setCooldown(0); }}>注册</button></>
          ) : (
            <>已有账号？<button onClick={() => { setIsLogin(true); setMsg(''); setPendingEmail(''); setCooldown(0); }}>登录</button></>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthModal;
