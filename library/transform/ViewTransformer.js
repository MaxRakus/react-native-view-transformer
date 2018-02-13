'use strict';

import React from 'react';
import ReactNative, {
  View,
  Animated,
  Easing,
  NativeModules
} from 'react-native';
import PropTypes from 'prop-types';
import { createResponder } from 'react-native-gesture-responder';
import Scroller from 'react-native-scroller';
import {
  Rect,
  Transform,
  transformedRect,
  availableTranslateSpace,
  fitCenterRect,
  alignedRect,
  getTransform,
} from './TransformUtils';

export default class ViewTransformer extends React.Component {

  static Rect = Rect;
  static getTransform = getTransform;

  constructor(props) {
    super(props);
    this.state = {
      //transform state
      scale: props.scale || 1,
      translateX: 0,
      translateY: 0,
      animatedScale: props.scale ? new Animated.Value(props.scale) : new Animated.Value(1),

      //animation state
      animator: new Animated.Value(0),

      //layout
      width: 0,
      height: 0,
      pageX: 0,
      pageY: 0,
      overTop: 0,
      overBottom: 0,
      overLeft: 0,
      overRight: 0,
    };
    this.manualScale = false;
    this._viewPortRect = new Rect(); //A holder to avoid new too much

    this.cancelAnimation = this.cancelAnimation.bind(this);
    this.contentRect = this.contentRect.bind(this);
    this.transformedContentRect = this.transformedContentRect.bind(this);
    this.animate = this.animate.bind(this);

    this.scroller = new Scroller(true, (dx, dy, scroller) =>{
      if (dx === 0 && dy === 0 && scroller.isFinished()) {
        this.animateBounce();
        return;
      }

      this.updateTransform({
        translateX: this.state.translateX + dx / this.state.scale,
        translateY: this.state.translateY + dy / this.state.scale
      });
    });
  }

  viewPortRect() {
    this._viewPortRect.set(0, 0, this.state.width, this.state.height);
    return this._viewPortRect;
  }

  contentRect() {
    let rect = this.viewPortRect().copy();
    if (this.props.contentAspectRatio && this.props.contentAspectRatio > 0) {
      rect = fitCenterRect(this.props.contentAspectRatio, rect);
    }
    return rect;
  }

  transformedContentRect() {
    let rect = transformedRect(this.viewPortRect(), this.currentTransform());
    if (this.props.contentAspectRatio && this.props.contentAspectRatio > 0) {
      rect = fitCenterRect(this.props.contentAspectRatio, rect);
    }
    return rect;
  }

  currentTransform() {
    return new Transform(this.state.scale, this.state.translateX, this.state.translateY);
  }

  componentWillMount() {
    this.gestureResponder = createResponder({
      onStartShouldSetResponder: (evt, gestureState) => true,
      onMoveShouldSetResponderCapture: (evt, gestureState) => true,
      //onMoveShouldSetResponder: this.handleMove,
      onResponderMove: this.onResponderMove.bind(this),
      onResponderGrant: this.onResponderGrant.bind(this),
      onResponderRelease: this.onResponderRelease.bind(this),
      onResponderTerminate: this.onResponderRelease.bind(this),
      onResponderTerminationRequest: (evt, gestureState) => false, //Do not allow parent view to intercept gesture
      onResponderSingleTapConfirmed: (evt, gestureState) => {
        this.props.onSingleTapConfirmed && this.props.onSingleTapConfirmed();
      }
    });
  }

  componentDidUpdate(prevProps, prevState) {
    this.props.onViewTransformed && this.props.onViewTransformed({
      scale: this.state.scale,
      translateX: this.state.translateX,
      translateY: this.state.translateY
    });
  }

  componentWillUnmount() {
    this.cancelAnimation();
  }

  render() {
    let gestureResponder = this.gestureResponder;
    if (!this.props.enableTransform) {
      gestureResponder = {};
    }

    return (
      <View
        {...this.props}
        {...gestureResponder}
        ref={'innerViewRef'}
        onLayout={this.onLayout.bind(this)}>
        <Animated.View
          style={{
            flex: 1,
            transform: [
                  {scale: this.manualScale ? this.state.animatedScale : this.state.scale},
                  {translateX: this.state.translateX},
                  {translateY: this.state.translateY}
                ]
          }}>
          {this.props.children}
        </Animated.View>
      </View>
    );
  }

  onLayout(e) {
    const {width, height} = e.nativeEvent.layout;
    if(width !== this.state.width || height !== this.state.height) {
      this.setState({width, height});
    }
    this.measureLayout();

    this.props.onLayout && this.props.onLayout(e);
  }

  measureLayout() {
    let handle = ReactNative.findNodeHandle(this.refs['innerViewRef']);
    NativeModules.UIManager.measure(handle, ((x, y, width, height, pageX, pageY) => {
      if(typeof pageX === 'number' && typeof pageY === 'number') { //avoid undefined values on Android devices
        if(this.state.pageX !== pageX || this.state.pageY !== pageY) {
          const availablePanDistance = availableTranslateSpace(this.transformedContentRect(), this.viewPortRect());
          this.setState({
            pageX: pageX,
            pageY: pageY,
            overTop: availablePanDistance.top,
            overBottom: availablePanDistance.bottom,
            overLeft: availablePanDistance.left,
            overRight: availablePanDistance.right,
          });
        }
      }
    }).bind(this));
  }

  onResponderGrant(evt, gestureState) {
    this.props.onTransformStart && this.props.onTransformStart();
    this.setState({responderGranted: true});
    this.measureLayout();
  }

  onResponderMove(evt, gestureState) {
    this.cancelAnimation();

    let dx = gestureState.moveX - gestureState.previousMoveX;
    let dy = gestureState.moveY - gestureState.previousMoveY;
    if (this.props.enableResistance) {
      let d = this.applyResistance(dx, dy);
      dx = d.dx;
      dy = d.dy;
    }

    if(!this.props.enableTranslate) {
      dx = dy = 0;
    }

    let transform = {};
    if (gestureState.previousPinch && gestureState.pinch && this.props.enableScale) {
      const scaleBy = gestureState.pinch / gestureState.previousPinch;
      let pivotX = gestureState.moveX - this.state.pageX;
      let pivotY = gestureState.moveY - this.state.pageY;

      let rect = transformedRect(transformedRect(this.contentRect(), this.currentTransform()), new Transform(
        scaleBy, dx, dy,
        {
          x: pivotX,
          y: pivotY
        }
      ));
      transform = getTransform(this.contentRect(), rect);
    } else {
      if (Math.abs(dx) > 2 * Math.abs(dy)) {
        dy = 0;
      } else if (Math.abs(dy) > 2 * Math.abs(dx)) {
        dx = 0;
      }

      if (dx !== 0) {
        transform.overRight = this.state.overRight + dx;
        transform.overLeft = this.state.overLeft - dx;
      }
      if (dy !== 0) {
        transform.overTop = this.state.overTop - dy;
        transform.overBottom = this.state.overBottom + dy;
      }

      transform.translateX = this.state.translateX + dx / this.state.scale;
      transform.translateY = this.state.translateY + dy / this.state.scale;
    }

    if (transform.scale) {
      if (transform.scale >= 1 && transform.scale <= 7) {
        this.updateTransform(transform);
      }
    } else if (this.state.overTop - dy >= 0
        && this.state.overBottom + dy >= 0
        && this.state.overLeft - dx >= 0
        && this.state.overRight + dx >= 0) {
          this.updateTransform(transform);
    }
    return true;
  }

  onResponderRelease(evt, gestureState) {
    let handled = this.props.onTransformGestureReleased && this.props.onTransformGestureReleased({
        scale: this.state.scale,
        translateX: this.state.translateX,
        translateY: this.state.translateY
      });
    if (handled) {
      return;
    }

    const availablePanDistance = availableTranslateSpace(this.transformedContentRect(), this.viewPortRect());

    if (gestureState.doubleTapUp) {
      if (!this.props.enableScale) {
        this.animateBounce();
        return;
      }
      let pivotX = 0, pivotY = 0;
      if (gestureState.dx || gestureState.dy) {
        pivotX = gestureState.moveX - this.state.pageX;
        pivotY = gestureState.moveY - this.state.pageY;
      } else {
        pivotX = gestureState.x0 - this.state.pageX;
        pivotY = gestureState.y0 - this.state.pageY;
      }

      this.performDoubleTapUp(pivotX, pivotY);
    } else {
      if (this.props.enableTranslate) {
        if (availablePanDistance.top < 0
          || availablePanDistance.bottom < 0
          || availablePanDistance.left < 0
          || availablePanDistance.right < 0) {
          this.setState({
            overTop: 0,
            overBottom: 0,
            overLeft: 0,
            overRight: 0,
          });
          this.performFling(gestureState.vx, gestureState.vy);
        } else {
          this.setState({
            overTop: availablePanDistance.top,
            overBottom: availablePanDistance.bottom,
            overLeft: availablePanDistance.left,
            overRight: availablePanDistance.right,
          });
        }
      } else {
        this.animateBounce();
      }
    }
  }

  performFling(vx, vy) {
    let startX = 0;
    let startY = 0;
    let maxX, minX, maxY, minY;
    let availablePanDistance = availableTranslateSpace(this.transformedContentRect(), this.viewPortRect());
    if (vx > 0) {
      minX = 0;
      if (availablePanDistance.left > 0) {
        maxX = availablePanDistance.left + this.props.maxOverScrollDistance;
      } else {
        maxX = 0;
      }
    } else {
      maxX = 0;
      if (availablePanDistance.right > 0) {
        minX = -availablePanDistance.right - this.props.maxOverScrollDistance;
      } else {
        minX = 0;
      }
    }
    if (vy > 0) {
      minY = 0;
      if (availablePanDistance.top > 0) {
        maxY = availablePanDistance.top + this.props.maxOverScrollDistance;
      } else {
        maxY = 0;
      }
    } else {
      maxY = 0;
      if (availablePanDistance.bottom > 0) {
        minY = -availablePanDistance.bottom - this.props.maxOverScrollDistance;
      } else {
        minY = 0;
      }
    }

    vx *= 1000; //per second
    vy *= 1000;
    if (Math.abs(vx) > 2 * Math.abs(vy)) {
      vy = 0;
    } else if (Math.abs(vy) > 2 * Math.abs(vx)) {
      vx = 0;
    }

    this.scroller.fling(startX, startY, vx, vy, minX, maxX, minY, maxY);
  }

  performDoubleTapUp(pivotX, pivotY) {
    // console.log('performDoubleTapUp...pivot=' + pivotX + ', ' + pivotY);
    let curScale = this.state.scale;
    let scaleBy;
    if (curScale > (1 + this.props.maxScale) / 2) {
      scaleBy = 1 / curScale;
    } else {
      scaleBy = this.props.maxScale / curScale;
    }
    let rect = transformedRect(this.transformedContentRect(), new Transform(
      scaleBy, 0, 0,
      {
        x: pivotX,
        y: pivotY
      }
    ));
    rect = transformedRect(rect, new Transform(1, this.viewPortRect().centerX() - pivotX, this.viewPortRect().centerY() - pivotY));
    rect = alignedRect(rect, this.viewPortRect());

    this.animate(rect);
  }

  applyResistance(dx, dy) {
    let availablePanDistance = availableTranslateSpace(this.transformedContentRect(), this.viewPortRect());

    if ((dx > 0 && availablePanDistance.left < 0)
      ||
      (dx < 0 && availablePanDistance.right < 0)) {
      dx /= 3;
    }
    if ((dy > 0 && availablePanDistance.top < 0)
      ||
      (dy < 0 && availablePanDistance.bottom < 0)) {
      dy /= 3;
    }
    return {
      dx, dy
    }
  }

  cancelAnimation() {
    this.state.animator.stopAnimation();
  }

  animate = (targetRect, durationInMillis) => new Promise((resolve) => {
    let duration = 200;
    if (durationInMillis) {
      duration = durationInMillis;
    }

    let fromRect = this.transformedContentRect();
    if (fromRect.equals(targetRect)) {
      // console.log('animate...equal rect, skip animation');
      resolve();
      return;
    }

    this.state.animator.removeAllListeners();
    this.state.animator.setValue(0);
    this.state.animator.addListener((state) =>{
      let progress = state.value;

      let left = fromRect.left + (targetRect.left - fromRect.left) * progress;
      let right = fromRect.right + (targetRect.right - fromRect.right) * progress;
      let top = fromRect.top + (targetRect.top - fromRect.top) * progress;
      let bottom = fromRect.bottom + (targetRect.bottom - fromRect.bottom) * progress;

      let transform = getTransform(this.contentRect(), new Rect(left, top, right, bottom));
      const availablePanDistance = availableTranslateSpace(this.transformedContentRect(), this.viewPortRect());
      transform.overTop = availablePanDistance.top;
      transform.overBottom = availablePanDistance.bottom;
      transform.overLeft = availablePanDistance.left;
      transform.overRight = availablePanDistance.right;
      this.updateTransform(transform);
    });
    Animated.timing(this.state.animator, {
      toValue: 1,
      duration,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start(() => resolve());
  });

  animateBounce() {
    let curScale = this.state.scale;
    let minScale = 1;
    let maxScale = this.props.maxScale;
    let scaleBy = 1;
    if (curScale > maxScale) {
      scaleBy = maxScale / curScale;
    } else if (curScale < minScale) {
      scaleBy = minScale / curScale;
    }

    let rect = transformedRect(this.transformedContentRect(), new Transform(
      scaleBy,
      0,
      0,
      {
        x: this.viewPortRect().centerX(),
        y: this.viewPortRect().centerY()
      }
    ));
    rect = alignedRect(rect, this.viewPortRect());
    this.animate(rect);
  }

  // Above are private functions. Do not use them if you don't known what you are doing.
  // ***********************************************************************************
  // Below are public functions. Feel free to use them.


  updateTransform(transform) {
    this.setState(transform);
  }

  animatedScale = (toScale, pivotX, pivotY) => new Promise(async (resolve) => {
    let curScale = this.state.scale;
    let scaleBy;
    if (curScale > (1 + this.props.maxScale) / 2) {
      scaleBy = 1 / curScale;
    } else {
      scaleBy = this.props.maxScale / curScale;
    }
    let rect = transformedRect(this.transformedContentRect(), new Transform(
      scaleBy, 0, 0,
      {
        x: pivotX,
        y: pivotY
      }
    ));
    rect = transformedRect(rect, new Transform(toScale, this.viewPortRect().centerX() - pivotX, this.viewPortRect().centerY() - pivotY));
    rect = alignedRect(rect, this.viewPortRect());
    await this.animate(rect, 400);
    resolve();
  });

  forceUpdateTransform(transform) {
    this.setState(transform);
  }

  getAvailableTranslateSpace() {
    return availableTranslateSpace(this.transformedContentRect(), this.viewPortRect());
  }
}

ViewTransformer.propTypes = {
  /**
   * Use false to disable transform. Default is true.
   */
  enableTransform: PropTypes.bool,

  /**
   * Use false to disable scaling. Default is true.
   */
  enableScale: PropTypes.bool,

  /**
   * Use false to disable translateX/translateY. Default is true.
   */
  enableTranslate: PropTypes.bool,

  /**
   * Default is 20
   */
  maxOverScrollDistance: PropTypes.number,

  maxScale: PropTypes.number,
  contentAspectRatio: PropTypes.number,

  /**
   * Use true to enable resistance effect on over pulling. Default is false.
   */
  enableResistance: PropTypes.bool,

  onViewTransformed: PropTypes.func,

  onTransformGestureReleased: PropTypes.func,

  onSingleTapConfirmed: PropTypes.func
};
ViewTransformer.defaultProps = {
  maxOverScrollDistance: 20,
  enableScale: true,
  enableTranslate: true,
  enableTransform: true,
  maxScale: 1,
  enableResistance: false,
};
