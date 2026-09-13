import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import NextStatusChart from '@/components/ui/charts/nextStatusChart';

type ResizeObserverCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver
) => void;

describe('NextStatusChart', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let resizeObserverInstances: MockResizeObserver[];

  class MockResizeObserver implements ResizeObserver {
    callback: ResizeObserverCallback;
    observedElements: Element[] = [];
    disconnect = jest.fn(() => {
      this.observedElements = [];
    });
    observe = jest.fn((element: Element) => {
      this.observedElements.push(element);
    });
    unobserve = jest.fn((element: Element) => {
      this.observedElements = this.observedElements.filter((el) => el !== element);
    });

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      resizeObserverInstances.push(this);
    }
  }

  beforeEach(() => {
    resizeObserverInstances = [];
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  const expectNoRechartsZeroDimensionWarning = () => {
    const zeroDimensionWarning = warnSpy.mock.calls.find((call) =>
      call.some(
        (arg: unknown) =>
          typeof arg === 'string' &&
          arg.includes('The width(') &&
          arg.includes('should be greater than 0')
      )
    );
    expect(zeroDimensionWarning).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  };

  it('does not log a Recharts 0-dimension warning when container has zero dimensions', () => {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const { container } = render(<NextStatusChart points={1300} />);

    // The placeholder container is rendered
    expect(screen.getByTestId('next-status-chart-placeholder')).toBeInTheDocument();

    // Chart elements are not mounted into zero dimensions
    expect(container.querySelector('.recharts-responsive-container')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-surface')).not.toBeInTheDocument();

    // Points text outside CardContent is rendered
    expect(screen.getByText('1,700 points until Gold')).toBeInTheDocument();

    // No zero dimension warnings logged by Recharts
    expectNoRechartsZeroDimensionWarning();
  });

  it('mounts and renders chart elements without warning when container has positive dimensions', () => {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      bottom: 300,
      right: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const { container } = render(<NextStatusChart points={1300} />);

    // Chart elements mount
    expect(screen.queryByTestId('next-status-chart-placeholder')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
    expect(container.querySelector('.recharts-surface')).toBeInTheDocument();

    // Rendered text inside pie chart label
    expect(screen.getByText('1,300')).toBeInTheDocument();
    expect(screen.getByText('points')).toBeInTheDocument();

    // Rendered tier label
    expect(screen.getByText('1,700 points until Gold')).toBeInTheDocument();

    // Pie chart element and label elements are rendered
    expect(container.querySelector('.recharts-pie')).toBeInTheDocument();

    // No zero dimension warning logged
    expectNoRechartsZeroDimensionWarning();
  });

  it('transitions from zero dimensions to positive dimensions when ResizeObserver fires', () => {
    const rectSpy = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

    const { container } = render(<NextStatusChart points={1300} />);

    expect(screen.getByTestId('next-status-chart-placeholder')).toBeInTheDocument();
    expect(container.querySelector('.recharts-surface')).not.toBeInTheDocument();

    // Simulate ResizeObserver reporting non-zero dimensions
    rectSpy.mockReturnValue({
      width: 350,
      height: 350,
      top: 0,
      left: 0,
      bottom: 350,
      right: 350,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    act(() => {
      resizeObserverInstances.forEach((observer) => {
        observer.callback(
          [
            {
              contentRect: {
                width: 350,
                height: 350,
                top: 0,
                left: 0,
                bottom: 350,
                right: 350,
                x: 0,
                y: 0,
                toJSON: () => {},
              },
              target: observer.observedElements[0],
            } as unknown as ResizeObserverEntry,
          ],
          observer
        );
      });
    });

    // Chart should now be mounted
    expect(screen.queryByTestId('next-status-chart-placeholder')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-surface')).toBeInTheDocument();
    expect(container.querySelector('.recharts-pie')).toBeInTheDocument();
    expect(screen.getByText('1,300')).toBeInTheDocument();
    expect(screen.getByText('points')).toBeInTheDocument();

    expectNoRechartsZeroDimensionWarning();
  });

  it('cleans up ResizeObserver on unmount', () => {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      bottom: 300,
      right: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const { unmount } = render(<NextStatusChart points={1300} />);
    const chartObserver = resizeObserverInstances[0];
    expect(chartObserver).toBeDefined();

    unmount();

    expect(chartObserver.disconnect).toHaveBeenCalled();
  });

  it('displays platinum status reached message when points reach 10000', () => {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      bottom: 300,
      right: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    render(<NextStatusChart points={10000} />);

    expect(screen.getByText('10,000')).toBeInTheDocument();
    expect(screen.getByText('Platinum Status Reached!')).toBeInTheDocument();
    expectNoRechartsZeroDimensionWarning();
  });
});
