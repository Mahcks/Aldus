import { Text, View } from './tw';
import { Button, Dialog } from './ui';

export function DownloadFormatDialog({
  visible,
  epubBytes,
  audioBytes,
  onClose,
  onDownload,
}: {
  visible: boolean;
  epubBytes?: number;
  audioBytes?: number;
  onClose: () => void;
  onDownload: (format: 'epub' | 'audio' | 'both') => void;
}) {
  const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return (
    <Dialog visible={visible} title="Download for offline" onClose={onClose}>
      <View className="gap-3">
        <Text className="text-base text-muted">
          Choose what to save on this device. Files already saved will be kept.
        </Text>
        {epubBytes != null ? (
          <Button
            label={`Ebook only · ${size(epubBytes)}`}
            kind="secondary"
            onPress={() => onDownload('epub')}
          />
        ) : null}
        {audioBytes != null ? (
          <Button
            label={`Audiobook only · ${size(audioBytes)}`}
            kind="secondary"
            onPress={() => onDownload('audio')}
          />
        ) : null}
        {epubBytes != null && audioBytes != null ? (
          <Button
            label={`Both · ${size(epubBytes + audioBytes)}`}
            onPress={() => onDownload('both')}
          />
        ) : null}
      </View>
    </Dialog>
  );
}
