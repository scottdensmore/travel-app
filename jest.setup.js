import '@testing-library/jest-dom';

// jsdom implements no layout, so it has no `scrollIntoView` at all -- calling
// it throws rather than doing nothing. Components that bring an error banner
// into view need it to exist; whether it was called is the component test's
// business, so this is a stub and not a no-op.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = jest.fn();
}
