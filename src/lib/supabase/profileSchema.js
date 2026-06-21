export function isMissingProfileColumn(error, columnName) {
  if (!columnName) return false;
  const message = String(error?.message || '');
  return error?.code === 'PGRST204' && message.includes(`'${columnName}'`);
}
