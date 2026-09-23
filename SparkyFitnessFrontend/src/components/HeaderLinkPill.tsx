import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HeaderLinkPillProps {
  href: string;
  label: string;
  icon: LucideIcon;
  className?: string;
  iconClassName?: string;
}

const HeaderLinkPill: React.FC<HeaderLinkPillProps> = ({
  href,
  label,
  icon: Icon,
  className,
  iconClassName,
}) => {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md text-sm text-gray-800 dark:text-gray-200 cursor-pointer',
        className
      )}
    >
      <Icon className={cn('h-4 w-4', iconClassName)} />
      <span>{label}</span>
    </a>
  );
};

export default HeaderLinkPill;
