package in.dukaan.sync.pipeline;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

@Configuration(proxyBeanMethods = false)
public class KafkaTopics {
    public static final String SHOP_OPS = "shop.ops";

    /** Key = shop_id, so one shop's ops stay ordered on one partition. Compose's kafka-init creates the same. */
    @Bean
    NewTopic shopOps(@Value("${dukaan.kafka.partitions:12}") int partitions) {
        return TopicBuilder.name(SHOP_OPS).partitions(partitions).replicas(1).config("compression.type", "lz4").build();
    }
}
