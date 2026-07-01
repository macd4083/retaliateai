export function shouldShowTrialExpiredModal(
  profileData,
  { feedbackDismissed = false, isGuestUser = false, now = new Date() } = {}
) {
  const trialExpired = profileData?.trial_ends_at
    ? new Date(profileData.trial_ends_at) < now
    : false;
  const isActive =
    profileData?.subscription_status === 'active' ||
    profileData?.subscription_status === 'canceling';
  const isTrialing =
    profileData?.subscription_status === 'trialing' && !trialExpired;
  const extendedTrialExpired = Boolean(
    trialExpired && profileData?.feedback_submitted && profileData?.trial_extended
  );

  return Boolean(
    !feedbackDismissed &&
      trialExpired &&
      !isActive &&
      (!profileData?.feedback_submitted || extendedTrialExpired) &&
      !isTrialing &&
      profileData?.role !== 'admin' &&
      !isGuestUser
  );
}
