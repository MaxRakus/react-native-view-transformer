'use strict';

import React from 'react';
import ReactNative, {
  View,
  Animated,
  Easing,
  NativeModules
} from 'react-native';

import {createResponder} from 'react-native-gesture-responder';

import Scroller from '../scroller/Scroller';

import {Rect, Transform, transformedRect, availableTranslateSpace, fitCenterRect, alignedRect, getTransform} from './TransformUtils';

const MIN_SCROLL_THRESHOLD = 10;

export default class ViewTransformer extends React.Component {

  static Rect = Rect;
  static getTransform = getTransform;


  constructor(props) {
    super(props);

    this.state = {
      //transform state
      scale: 1,
      translateX: 0,
      translateY: 0,

      //animation state
      animator: new Animated.Value(0),

      //layout
      width: 0,
      height: 0,
      pageX: 0,
      pageY: 0,

      //responder grant
      responderGranted: false
    };

    this._viewPortRect = new Rect();

    this.onLayout = this.onLayout.bind(this);
    this.handleScroll = this.handleScroll.bind(this);

    this.handleMove = this.handleMove.bind(this);
    this.handleRelease = this.handleRelease.bind(this);

    this.cancelAnimation = this.cancelAnimation.bind(this);
    this.contentRect = this.contentRect.bind(this);
    this.transformedContentRect = this.transformedContentRect.bind(this);
    this.animate = this.animate.bind(this);
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

  componentDidUpdate(prevProps, prevState) {
    this.props.onViewTransformed && this.props.onViewTransformed({
      scale: this.state.scale,
      translateX: this.state.translateX,
      translateY: this.state.translateY
    });
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
        style={[this.props.style, {overflow: 'visible'}]}>
        <View
          ref={'innerViewRef'}
          onLayout={this.onLayout}
          style={{
            flex: 1,
            transform: [
                  {scale: this.state.scale},
                  {translateX: this.state.translateX},
                  {translateY: this.state.translateY}
                ],
          }}>
          {this.props.children}
        </View>
      </View>

    );
  }

  componentWillMount() {
    this.gestureResponder = createResponder({
      onStartShouldSetResponder: (evt, gestureState) => {

        return true;
      },
      onMoveShouldSetResponder: this.handleMove,
      onResponderMove: this.handleMove,
      onResponderGrant: ((evt) => {
        this.props.onTransformStart && this.props.onTransformStart();
        this.setState({responderGranted: true});
      }).bind(this),
      onResponderRelease: this.handleRelease,
      onResponderTerminate: this.handleRelease,
      onResponderTerminationRequest: (evt, gestureState) => true
    });
    this.scroller = Scroller.create(this.handleScroll);
  }

  componentWillUnmount() {
    console.log('componentWillUnmount...');
    this.cancelAnimation();
  }

  onLayout(e) {
    let handle = ReactNative.findNodeHandle(this.refs['innerViewRef']);
    NativeModules.UIManager.measure(handle, ((x, y, width, height, pageX, pageY) => {
      this.setState({
        width: width,
        height: height,
        pageX: pageX,
        pageY: pageY
      });
    }).bind(this));
  }

  handleScroll(dx, dy, scroller:Scroller) {
    if (dx === 0 && dy === 0 && scroller.isFinished()) {
      this.animateBounce();
      return;
    }

    this.updateTransform({
      translateX: this.state.translateX + dx / this.state.scale,
      translateY: this.state.translateY + dy / this.state.scale
    })
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
    console.log('performDoubleTapUp...pivot=' + pivotX + ', ' + pivotY);
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

  handleMove(e, gestureState) {
    console.log('handleMove...');

    if (!this.state.responderGranted) {
      if (Math.abs(gestureState.dx) >= MIN_SCROLL_THRESHOLD || Math.abs(gestureState.dy) >= MIN_SCROLL_THRESHOLD) {
        console.log('handleMove...require responder');
        return true;
      } else {
        return false;
      }
    }


    this.cancelAnimation();

    let dx = gestureState.moveX - gestureState.previousMoveX;
    let dy = gestureState.moveY - gestureState.previousMoveY;
    if (this.props.enableResistance) {
      let d = this.applyResistance(dx, dy);
      dx = d.dx;
      dy = d.dy;
    }

    let transform = {};
    if (gestureState.previousPinch && gestureState.pinch) {
      let scaleBy = gestureState.pinch / gestureState.previousPinch;
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
      transform.translateX = this.state.translateX + dx / this.state.scale;
      transform.translateY = this.state.translateY + dy / this.state.scale;
    }

    this.updateTransform(transform);
    return true;
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

  handleRelease(e, gestureState) {
    console.log('handleRelease...' + JSON.stringify(gestureState));
    this.setState({
      responderGranted: false
    });

    let handled = this.props.onTransformGestureReleased && this.props.onTransformGestureReleased({
        scale: this.state.scale,
        translateX: this.state.translateX,
        translateY: this.state.translateY
      });
    if (handled) {
      return;
    }


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
      this.performFling(gestureState.vx, gestureState.vy);
    }
  }

  cancelAnimation() {
    this.state.animator.stopAnimation();
  }

  animate(targetRect, durationInMillis) {
    let duration = 200;
    if (durationInMillis) {
      duration = durationInMillis;
    }

    let fromRect = this.transformedContentRect();
    if (fromRect.equals(targetRect)) {
      console.log('animate...equal rect, skip animation');
      return;
    }

    this.state.animator.removeAllListeners();
    this.state.animator.setValue(0);
    this.state.animator.addListener(function (state) {
      let progress = state.value;

      let left = fromRect.left + (targetRect.left - fromRect.left) * progress;
      let right = fromRect.right + (targetRect.right - fromRect.right) * progress;
      let top = fromRect.top + (targetRect.top - fromRect.top) * progress;
      let bottom = fromRect.bottom + (targetRect.bottom - fromRect.bottom) * progress;

      let transform = getTransform(this.contentRect(), new Rect(left, top, right, bottom));

      this.updateTransform(transform);
    }.bind(this));
    Animated.timing(this.state.animator, {
      toValue: 1,
      duration: duration,
      easing: Easing.inOut(Easing.ease)
    }).start();
  }

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

  updateTransform(transform) {
    if (this.props.enableTransform) {
      if (!this.props.enableScale) {
        transform.scale = 1;
      }

      this.setState(transform);
    }
  }

  setTransform(transform) {
    this.setState(transform);
  }
}

ViewTransformer.propTypes = {
  /**
   * Use false to disable transform. Default is true.
   */
  enableTransform: React.PropTypes.bool,

  /**
   * Use false to disable scaling. Default is true.
   */
  enableScale: React.PropTypes.bool,

  /**
   * Default is 20
   */
  maxOverScrollDistance: React.PropTypes.number,

  maxScale: React.PropTypes.number,

  /**
   * Use true to enable resistance effect on over pulling. Default is false.
   */
  enableResistance: React.PropTypes.bool,

  onViewTransformed: React.PropTypes.func,

  onTransformGestureReleased: React.PropTypes.func
};
ViewTransformer.defaultProps = {
  maxOverScrollDistance: 20,
  enableScale: true,
  enableTransform: true,
  maxScale: 1,
  enableResistance: false
};