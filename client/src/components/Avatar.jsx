export default function Avatar({ name = '?', online, size = '', className = '' }) {
  const color = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 6;
  return (
    <span className={`avatar avatar-${color} ${size} ${className}`} aria-hidden="true">
      {name.slice(0, 2).toUpperCase()}
      {online !== undefined && <i className={online ? 'online-dot' : 'offline-dot'} />}
    </span>
  );
}
