import React from 'react';
import { Button } from './button';
import { Loader2 } from 'lucide-react';

interface LoadButtonProps {
  onLoad: () => void;
  disabled: boolean;
  loading: boolean;
}

const LoadButton: React.FC<LoadButtonProps> = ({ onLoad, disabled, loading }) => {
  return (
    <Button
      onClick={onLoad}
      disabled={disabled}
      className="w-full py-6"
      size="lg"
    >
      {loading && <Loader2 className="animate-spin" />}
      <span>{loading ? 'Loading...' : 'Load File'}</span>
    </Button>
  );
};

export default LoadButton;
