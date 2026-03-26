export default function Landing() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // If user is already logged in, redirect to app
  React.useEffect(() => {
    if (user) {
      navigate('/reflection');
    }
  }, [user, navigate]);

  const handleGetStarted = () => {
    navigate('/login?signup=true');
  };

  // Don't render anything while auth is resolving or if user is logged in
  if (loading || user) return null;

  return (
