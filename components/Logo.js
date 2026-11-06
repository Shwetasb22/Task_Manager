import Image from 'next/image';
import Link from 'next/link';

export default function Logo({ className = '', size = 36, priority = false }) {
  return (
    <Link href="/" aria-label="BYBRE dashboard" className={`inline-flex shrink-0 items-center ${className}`}>
      <Image src="/logo.png" alt="BYBRE logo" width={Math.round(size * 747 / 132)} height={size} priority={priority} />
    </Link>
  );
}
