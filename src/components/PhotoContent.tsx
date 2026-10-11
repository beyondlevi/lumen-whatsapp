import circlePlayFilled from '@wearables-ui-toolkit/icons/svg/circleplay__filled.svg';
import imageFilled from '@wearables-ui-toolkit/icons/svg/image__filled.svg';
import {IconImage, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {useEffect} from 'react';
import type {ChatMessage} from '../evolution/parse';

/**
 * A photo's (or a video's) thumbnail in its bubble. The box has the photo's
 * shape from the start (its size from the message, else 4:3), so nothing moves
 * when the image arrives; until then, or without one, it shows an image icon.
 * A video shows a play icon over its thumbnail (it is not played here).
 */
export function PhotoBox({
  src,
  width,
  height,
  alt,
  video = false,
}: {
  src: string | null;
  width?: number;
  height?: number;
  alt: string;
  video?: boolean;
}) {
  const shape = {aspectRatio: width && height ? `${width} / ${height}` : '4 / 3'};
  return (
    <div className="photo-box" style={shape}>
      {src ? (
        <img className="photo-box-image" src={src} alt={alt} decoding="async" />
      ) : (
        <IconImage className="photo-box-icon" source={imageFilled} />
      )}
      {video ? <IconImage className="photo-box-play" source={circlePlayFilled} /> : null}
    </div>
  );
}

/**
 * A photo or video from the conversation: its thumbnail and caption. A photo
 * that came without a thumbnail asks for one when its bubble is on screen.
 */
export function PhotoContent({
  message,
  thumbnail,
  alt,
  onNeedThumbnail,
}: {
  message: ChatMessage;
  thumbnail: string | null;
  alt: string;
  onNeedThumbnail: (message: ChatMessage) => void;
}) {
  const needed = thumbnail == null && message.content.kind === 'photo';
  useEffect(() => {
    if (needed) {
      onNeedThumbnail(message);
    }
    // Asked once per bubble on screen; a refreshed copy of the message is the same photo.
  }, [needed, message.id, onNeedThumbnail]);
  const {text, width, height, kind} = message.content;
  return (
    <div className="sent-photo">
      <PhotoBox src={thumbnail} width={width} height={height} alt={alt} video={kind === 'video'} />
      {text ? (
        <TextView className="message-text" as="p" textStyle={TextStyle.BODY2}>
          {text}
        </TextView>
      ) : null}
    </div>
  );
}
