When you create a new reusable component, make sure you add a LaunchDarkly feature flag to it.
The below is an example for the start of a component called MyComponentName.

import { LaunchDarklyService } from '@/lib/LaunchDarklyService';

const MyComponentName: React.FC = () => {
  if (!new LaunchDarklyService().getFlagStatus('my-component-name')) {
    return (
      <div></div>
      );
  };
