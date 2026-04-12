import React from 'react';

interface OrientationLineProps {
  text: string;
}

export const OrientationLine: React.FC<OrientationLineProps> = ({ text }) => (
  <p className="text-lg text-text-secondary px-6 py-4 leading-relaxed">{text}</p>
);
