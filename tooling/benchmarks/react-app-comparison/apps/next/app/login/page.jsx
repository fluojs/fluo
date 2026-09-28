export default function Login() {
  return (
    <>
      <p className="eyebrow">Editor access</p>
      <h1>Sign in</h1>
      <section className="panel">
        <form method="post" action="/login">
          <label>Username <input name="username" autoComplete="username" required /></label>
          <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
          <button type="submit">Sign in</button>
        </form>
      </section>
    </>
  );
}
