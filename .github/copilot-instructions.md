When you create a new reusable React component, make sure you add a LaunchDarkly feature flag to it.
Only do this for React components that you create.
The below is an example for the start of a component called MyComponentName.

import LaunchDarklyService from '@/lib/LaunchDarklyService';

const MyComponentName: React.FC = () => {
  if (!new LaunchDarklyService().getFlagStatus('my-component-name')) {
    return (
      <div></div>
      );
  };

For charting components, always add 'use client';